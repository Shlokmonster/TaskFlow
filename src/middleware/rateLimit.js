'use strict';

const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const handler = (_req, res) =>
  res.status(429).json({
    success: false,
    error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
  });

const shared = {
  standardHeaders: true,
  legacyHeaders: false,
  handler,
  // Supertest fires many requests from one address; throttling would make the
  // suite flaky rather than more correct.
  skip: () => env.IS_TEST,
};

/** Applied to every /api route. */
const apiLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
});

/** Tighter limit for credential endpoints. */
const authLimiter = rateLimit({
  ...shared,
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
});

module.exports = { apiLimiter, authLimiter };
