'use strict';

/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * handler instead of becoming an unhandled rejection.
 *
 *   router.get('/x', asyncHandler(async (req, res) => { ... }))
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
