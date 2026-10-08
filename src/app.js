'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const env = require('./config/env');
const logger = require('./config/logger');
const { dbState } = require('./config/db');
const { isFirebaseEnabled } = require('./config/firebase');
const { swaggerSpec } = require('./config/swagger');
const routes = require('./routes');
const sanitize = require('./middleware/sanitize');
const { apiLimiter } = require('./middleware/rateLimit');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/error');

/**
 * The Express app — no `listen()` here on purpose. `server.js` owns the HTTP
 * server so the app can be imported directly by tests.
 */
const app = express();

// Behind a load balancer (Render, Heroku) so rate limiting sees the real IP.
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Swagger UI injects its bundle and styles inline.
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: env.corsOrigin(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  })
);

app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: env.JSON_BODY_LIMIT }));

// Strip $-prefixed / dotted keys before anything can hand them to MongoDB.
app.use(sanitize);

if (!env.IS_TEST) {
  app.use(morgan(env.IS_PROD ? 'combined' : 'dev', { stream: logger.stream }));
}

// --- Health (outside the API rate limit, so probes never get throttled) -----
app.get('/health', (_req, res) =>
  res.status(200).json({
    success: true,
    message: 'TaskFlow API is running',
    data: {
      status: 'ok',
      database: dbState(),
      firebase: isFirebaseEnabled(),
      docsDemo: env.DOCS_DEMO_MODE,
      uptime: Math.round(process.uptime() * 100) / 100,
      environment: env.NODE_ENV,
      timestamp: new Date().toISOString(),
    },
  })
);

// --- API docs --------------------------------------------------------------
const DOCS_DIR = path.join(__dirname, 'docs');

// Inlined rather than linked so the styling cannot 404 into an unstyled page.
// A missing stylesheet is cosmetic, so it degrades to a warning, not a crash.
const docsCss = (() => {
  try {
    return fs.readFileSync(path.join(DOCS_DIR, 'swagger-theme.css'), 'utf8');
  } catch (err) {
    logger.warn('Swagger theme stylesheet unavailable:', err.message);
    return '';
  }
})();

/**
 * The spec with its server URL pinned to the host that is asking.
 *
 * Without this the document carries whatever base URL the build machine knew,
 * so "Try it out" on a deployed instance posts to the developer's localhost.
 * Deriving it from the request means the page is correct on Render, on a custom
 * domain, and on a laptop, with nothing to configure.
 */
function specForRequest(req) {
  const url = env.publicUrlFor(req);
  if (!url) return swaggerSpec;
  return { ...swaggerSpec, servers: [{ url, description: 'This server' }] };
}

// Registered before the swagger-ui middleware so it wins the /api/docs/* match.
app.get('/api/docs/guide.js', (_req, res) => res.type('application/javascript').sendFile(path.join(DOCS_DIR, 'swagger-guide.js')));

app.get('/api/docs.json', (req, res) => res.json(specForRequest(req)));

// The UI is handed the document's *URL*, not the document, so the per-request
// rewrite above is what it actually loads.
app.use(
  '/api/docs',
  apiLimiter,
  swaggerUi.serve,
  swaggerUi.setup(null, {
    customSiteTitle: 'TaskFlow API',
    customCss: docsCss,
    customJs: '/api/docs/guide.js',
    swaggerOptions: {
      url: '/api/docs.json',
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      displayRequestDuration: true,
    },
  })
);

// --- API -------------------------------------------------------------------
app.use(env.API_PREFIX, apiLimiter, routes);

// --- 404 + centralized error handling (must be last) -----------------------
app.use(notFound);
app.use(errorHandler);

module.exports = app;
