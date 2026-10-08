'use strict';

const mongoose = require('mongoose');

const env = require('../config/env');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');

/**
 * Translate anything thrown anywhere in the app into a single ApiError shape.
 * Unknown errors are logged with their stack and reported as an opaque 500.
 */
function normalise(err) {
  if (err instanceof ApiError) return err;

  // Mongoose schema validation
  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return ApiError.validation(details);
  }

  // Bad ObjectId / uncastable value
  if (err.name === 'CastError') {
    return new ApiError(400, 'BAD_REQUEST', `Invalid value for '${err.path}': ${err.value}`);
  }

  // Duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    const value = err.keyValue ? err.keyValue[field] : undefined;
    return ApiError.conflict(`${field} '${value}' is already in use`, [{ field, message: 'Must be unique' }]);
  }

  // JWT
  if (err.name === 'JsonWebTokenError') return ApiError.unauthorized('Invalid authentication token');
  if (err.name === 'TokenExpiredError') return ApiError.unauthorized('Authentication token has expired');
  if (err.name === 'NotBeforeError') return ApiError.unauthorized('Authentication token is not active yet');

  // Body parser
  if (err.type === 'entity.parse.failed') return ApiError.badRequest('Request body is not valid JSON');
  if (err.type === 'entity.too.large') return ApiError.badRequest('Request body is too large');
  if (err.type === 'request.aborted') return ApiError.badRequest('Request was aborted before it completed');

  // Mongo driver level failures
  if (err.name === 'MongoNetworkError' || err.name === 'MongooseServerSelectionError') {
    return ApiError.serviceUnavailable('Database is temporarily unavailable');
  }

  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const apiError = normalise(err);

  if (!apiError) {
    logger.error('Unhandled error on %s %s:', req.method, req.originalUrl, err);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong',
        ...(env.IS_PROD ? {} : { debug: err.message, stack: err.stack?.split('\n').slice(0, 5) }),
      },
    });
  }

  // Only genuine internal failures are errors; an expected 503 (Firebase not
  // configured) or a 5xx we raise deliberately is a warning.
  if (apiError.code === 'INTERNAL_ERROR') {
    logger.error('%s %s → %s: %s', req.method, req.originalUrl, apiError.code, apiError.message);
  } else if (apiError.statusCode >= 500) {
    logger.warn('%s %s → %s: %s', req.method, req.originalUrl, apiError.code, apiError.message);
  } else if (!env.IS_TEST) {
    logger.debug('%s %s → %s: %s', req.method, req.originalUrl, apiError.code, apiError.message);
  }

  const body = {
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
    },
  };
  if (apiError.details) body.error.details = apiError.details;

  return res.status(apiError.statusCode).json(body);
}

/** Async errors thrown before the error handler is mounted (e.g. bad JSON). */
errorHandler.notFound = require('./notFound');

module.exports = errorHandler;
module.exports.normalise = normalise;
module.exports.mongoose = mongoose;
