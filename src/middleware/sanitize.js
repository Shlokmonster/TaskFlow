'use strict';

/**
 * NoSQL-injection scrubber.
 *
 * Strips any key that starts with `$` or contains a `.` from the request body,
 * query and params — the two shapes MongoDB treats as operators / path
 * traversal (`{ email: { $gt: '' } }`, `{ 'a.b': 1 }`).
 *
 * Why not `express-mongo-sanitize`: it assigns to `req.query`, which Express
 * exposes as a getter-only prototype property. On modern Express that either
 * throws or silently does nothing. Rebuilding the object and redefining the
 * property avoids that entirely, with identical protection.
 */

const FORBIDDEN_KEY = /^\$|\./;

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== 'object') return value;
  // Leave exotic objects (Date, Buffer, ObjectId) untouched.
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }

  const clean = {};
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    clean[key] = scrub(nested);
  }
  return clean;
}

function sanitize(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = scrub(req.body);
  if (req.params && typeof req.params === 'object') req.params = scrub(req.params);

  if (req.query && typeof req.query === 'object') {
    const cleanQuery = scrub({ ...req.query });
    Object.defineProperty(req, 'query', {
      value: cleanQuery,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  next();
}

module.exports = sanitize;
module.exports.scrub = scrub;
