'use strict';

const User = require('../models/user.model');
const logger = require('../config/logger');
const { verifyToken, extractBearer } = require('../utils/jwt');

/**
 * Socket.io handshake authentication.
 *
 * Accepts the JWT from `auth.token` (preferred), an `Authorization: Bearer`
 * header, or `?token=` for clients that cannot set handshake auth. A socket is
 * never admitted without a valid token for an active account.
 */
module.exports = async function socketAuth(socket, next) {
  try {
    const token =
      socket.handshake.auth?.token ||
      extractBearer(socket.handshake.headers?.authorization) ||
      socket.handshake.query?.token;

    if (!token) return next(new Error('unauthorized: an authentication token is required'));

    const payload = verifyToken(String(token));
    const user = await User.findById(payload.sub).select('name email role isActive');

    if (!user) return next(new Error('unauthorized: account no longer exists'));
    if (!user.isActive) return next(new Error('unauthorized: account is deactivated'));

    socket.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
    };

    return next();
  } catch (err) {
    logger.debug('Socket handshake rejected: %s', err.message);
    return next(new Error(`unauthorized: ${err.message}`));
  }
};
