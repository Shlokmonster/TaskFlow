'use strict';

const ApiError = require('../utils/ApiError');

/** Catch-all for unmatched routes — runs after every router. */
const notFound = (req, _res, next) => {
  next(new ApiError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} does not exist`));
};

module.exports = notFound;
