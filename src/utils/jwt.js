'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('./ApiError');

const baseOptions = { issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE };

/**
 * Sign an access token for a user document.
 * The payload stays deliberately small — role is included so the authorize
 * middleware can short-circuit, but the authenticate middleware always
 * re-reads the user so a role change takes effect immediately.
 */
function signToken(user, expiresIn = env.JWT_EXPIRES_IN) {
  const payload = {
    sub: String(user._id || user.id),
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, env.JWT_SECRET, { ...baseOptions, expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, baseOptions);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw ApiError.unauthorized('Token has expired');
    throw ApiError.unauthorized('Invalid authentication token');
  }
}

/** Pull a bearer token out of an Authorization header value. */
function extractBearer(header) {
  if (!header || typeof header !== 'string') return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim();
}

module.exports = { signToken, verifyToken, extractBearer };
