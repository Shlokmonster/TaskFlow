'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Joi validation middleware.
 *
 *   validate({ params: idParam, query: listQuery, body: createBody })
 *
 * Unknown keys are stripped (never forwarded to mongoose), types are coerced
 * and every failure is collapsed into a single 422 with field-level details.
 */
const validate = (schemas = {}) => (req, _res, next) => {
  const details = [];

  for (const source of ['params', 'query', 'body']) {
    const schema = schemas[source];
    if (!schema) continue;

    const { value, error } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      details.push(
        ...error.details.map((d) => ({
          field: [source === 'body' ? null : source, ...d.path].filter(Boolean).join('.'),
          message: d.message,
        }))
      );
      continue;
    }

    if (source === 'query') {
      // Express exposes `req.query` through a prototype getter, so it has to be
      // redefined as an own property rather than assigned.
      Object.defineProperty(req, 'query', { value, writable: true, configurable: true, enumerable: true });
    } else {
      req[source] = value;
    }
  }

  if (details.length) return next(ApiError.validation(details));
  return next();
};

module.exports = validate;
