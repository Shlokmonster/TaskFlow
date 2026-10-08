'use strict';

const ApiError = require('../utils/ApiError');

/**
 * Coarse role gate. Always pair it with a resource-level check inside the
 * service — a role alone never proves the caller may touch *this* project,
 * task or comment.
 *
 *   router.post('/', authorize('lead', 'admin'), ctrl.create)
 */
const authorize = (...roles) => {
  const allowed = roles.flat();

  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden(`This action requires one of the following roles: ${allowed.join(', ')}`)
      );
    }
    return next();
  };
};

module.exports = authorize;
