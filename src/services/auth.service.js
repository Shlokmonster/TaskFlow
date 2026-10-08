'use strict';

const User = require('../models/user.model');
const ApiError = require('../utils/ApiError');
const { signToken } = require('../utils/jwt');
const { verifyIdToken, isFirebaseEnabled } = require('../config/firebase');
const logger = require('../config/logger');

/** Shape returned by every auth entry point. */
const issueSession = (user) => ({
  token: signToken(user),
  tokenType: 'Bearer',
  user: user.toJSON(),
});

/** Record the login and (optionally) register the caller's device token. */
async function touchLogin(user, fcmToken) {
  user.lastLoginAt = new Date();
  if (fcmToken) user.addFcmToken(fcmToken);
  await user.save();
  return user;
}

async function register({ name, email, password, fcmToken, firebaseUid, avatarUrl }) {
  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) throw ApiError.conflict('An account with this email already exists', [{ field: 'email', message: 'Already registered' }]);

  const user = await User.create({
    name,
    email,
    password,
    firebaseUid: firebaseUid || undefined,
    avatarUrl: avatarUrl || null,
    fcmTokens: fcmToken ? [fcmToken] : [],
  });

  return issueSession(user);
}

async function loginWithPassword({ email, password, fcmToken }) {
  const user = await User.findOne({ email: String(email).toLowerCase() }).select('+password');

  // Deliberately identical message for "no such user" and "wrong password" so
  // the endpoint cannot be used to enumerate accounts.
  const invalid = ApiError.unauthorized('Invalid email or password');
  if (!user) throw invalid;

  const matches = await user.comparePassword(password);
  if (!matches) throw invalid;
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  await touchLogin(user, fcmToken);
  return issueSession(user);
}

/**
 * Sign in with a Firebase ID token, creating the TaskFlow account on first use
 * and linking `firebaseUid` to an existing email-based account.
 */
async function loginWithFirebase({ firebaseToken, fcmToken, name }) {
  if (!isFirebaseEnabled()) {
    throw ApiError.serviceUnavailable('Firebase authentication is not configured on this server');
  }

  let decoded;
  try {
    decoded = await verifyIdToken(firebaseToken);
  } catch (err) {
    logger.debug('Firebase ID token rejected: %s', err.message);
    throw ApiError.unauthorized('Invalid or expired Firebase ID token');
  }

  if (!decoded) throw ApiError.serviceUnavailable('Firebase authentication is not configured on this server');

  const email = decoded.email ? String(decoded.email).toLowerCase() : null;
  const lookup = [{ firebaseUid: decoded.uid }];
  if (email) lookup.push({ email });

  let user = await User.findOne({ $or: lookup });

  if (!user) {
    if (!email) throw ApiError.badRequest('This Firebase account has no email address, so a TaskFlow account cannot be created for it');

    user = await User.create({
      name: name || decoded.name || email.split('@')[0],
      email,
      firebaseUid: decoded.uid,
      avatarUrl: decoded.picture || null,
      fcmTokens: fcmToken ? [fcmToken] : [],
    });
    logger.info('Created account %s from Firebase sign-in', email);
    return issueSession(user);
  }

  if (!user.firebaseUid) {
    user.firebaseUid = decoded.uid; // link an existing password account
  }
  if (!user.isActive) throw ApiError.forbidden('Your account has been deactivated');

  await touchLogin(user, fcmToken);
  return issueSession(user);
}

/** Accepts either credential type, so POST /api/auth/login serves both flows. */
async function login({ email, password, firebaseToken, fcmToken, name }) {
  if (firebaseToken) return loginWithFirebase({ firebaseToken, fcmToken, name });
  return loginWithPassword({ email, password, fcmToken });
}

const getMe = (userId) => User.findById(userId);

async function updateMe(userId, { name, avatarUrl, fcmToken }) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User');

  if (name !== undefined) user.name = name;
  if (avatarUrl !== undefined) user.avatarUrl = avatarUrl || null;
  if (fcmToken) user.addFcmToken(fcmToken);

  await user.save();
  return user;
}

/** Drop a device token so this device stops receiving push. */
async function logout(userId, fcmToken) {
  if (fcmToken) {
    await User.updateOne({ _id: userId }, { $pull: { fcmTokens: fcmToken } });
  }
  return { loggedOut: true };
}

module.exports = { register, login, loginWithPassword, loginWithFirebase, getMe, updateMe, logout, issueSession };
