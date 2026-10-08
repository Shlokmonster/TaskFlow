'use strict';

const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { verifyToken, extractBearer } = require('../utils/jwt');

/**
 * Verify the bearer token and attach the *fresh* user document to `req.user`.
 *
 * The user is re-read on every request (rather than trusting the token body)
 * so a role change, deactivation or deletion takes effect immediately instead
 * of at token expiry.
 */
const authenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token) throw ApiError.unauthorized('Authentication token is required');

  const payload = verifyToken(token);

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('The account linked to this token no longer exists');
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  req.user = user;
  req.auth = { token, payload };
  next();
});

/**
 * Attach the user when a valid token is present, but never reject.
 * Used by routes whose response differs for anonymous visitors.
 */
const optionalAuthenticate = asyncHandler(async (req, _res, next) => {
  const token = extractBearer(req.headers.authorization);
  if (!token) return next();
  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive) req.user = user;
  } catch {
    // A bad token on an optional route is simply treated as anonymous.
  }
  return next();
});

module.exports = authenticate;
module.exports.authenticate = authenticate;
module.exports.optionalAuthenticate = optionalAuthenticate;
