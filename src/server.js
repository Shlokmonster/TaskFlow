'use strict';

const http = require('http');

const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const { connectDB, disconnectDB } = require('./config/db');
const { initFirebase } = require('./config/firebase');
const { initSockets } = require('./sockets');

const httpServer = http.createServer(app);
let io = null;

/**
 * Bind the port. A failure here (EADDRINUSE, a privileged port) is a startup
 * failure, so it is rejected into start()'s catch rather than being thrown as
 * an uncaught exception — which would otherwise run the graceful shutdown and
 * exit 0, telling a platform "clean stop" instead of "crashed".
 */
function listen() {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err);
    httpServer.once('error', onError);
    httpServer.listen(env.PORT, () => {
      httpServer.off('error', onError);
      // Runtime errors after a successful bind just get logged.
      httpServer.on('error', (err) => logger.error('HTTP server error:', err));
      resolve();
    });
  });
}

async function start() {
  try {
    await connectDB();

    // Optional integration — logs a warning and returns null when unconfigured.
    initFirebase();

    io = initSockets(httpServer);

    await listen();

    logger.info('TaskFlow API listening on port %d [%s]', env.PORT, env.NODE_ENV);
    logger.info('REST      http://localhost:%d%s', env.PORT, env.API_PREFIX);
    logger.info('Swagger   http://localhost:%d%s/docs', env.PORT, env.API_PREFIX);
    logger.info('Socket.io http://localhost:%d/socket.io', env.PORT);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      logger.error('Port %d is already in use — set PORT to a free port and try again.', env.PORT);
    } else {
      logger.error('Failed to start the server:', err.message);
    }
    process.exit(1);
  }
}

/** Close sockets, the HTTP server and the database before exiting. */
async function shutdown(signal, exitCode = 0) {
  logger.info('%s received — shutting down gracefully', signal);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10000);
  forceExit.unref();

  try {
    if (io) await new Promise((resolve) => io.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
    await disconnectDB();
    logger.info('Shutdown complete');
    process.exit(exitCode);
  } catch (err) {
    logger.error('Error during shutdown:', err.message);
    process.exit(1);
  }
}

['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => shutdown(signal));
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
  shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  shutdown('uncaughtException', 1);
});

if (require.main === module) start();

module.exports = { start, httpServer };
