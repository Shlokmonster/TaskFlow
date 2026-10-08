'use strict';

/**
 * Outbound notifications.
 *
 * Two channels, one call site:
 *   • Socket.io  — fanned out to `user:<id>` rooms, so a client with the app
 *                  open updates instantly.
 *   • FCM        — multicast push for devices that are not connected.
 *
 * The golden rule: **notifications never break the write that triggered them.**
 * Every failure path (Firebase not configured, bad credentials, network error,
 * stale tokens) is logged and swallowed. The caller has already committed to
 * the database by the time this runs.
 */

const User = require('../models/user.model');
const logger = require('../config/logger');
const { isFirebaseEnabled, getMessaging } = require('../config/firebase');
const { emitToUser } = require('../utils/socketRegistry');

const TYPES = Object.freeze({
  TASK_ASSIGNED: 'task_assigned',
  TASK_DEADLINE_CHANGED: 'task_deadline_changed',
  COMMENT_ADDED: 'comment_added',
  MENTIONED: 'mentioned',
  GENERAL: 'general',
});

// FCM error codes that mean "this token will never work again".
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
  'messaging/mismatched-credential',
]);

/** FCM data payloads must be flat strings. */
function stringifyData(data = {}) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    out[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return out;
}

/**
 * Notify a set of users over sockets and push.
 *
 * @param {object} options
 * @param {Array<string|import('mongoose').Types.ObjectId>} options.userIds
 * @param {string} options.title
 * @param {string} options.body
 * @param {object} [options.data]  extra payload (ids, type, …)
 * @param {string} [options.type]  one of TYPES
 * @param {string} [options.excludeUserId] never notify the actor themselves
 * @returns {Promise<{socket:number, sent:number, failed:number, pruned:number, skipped:boolean}>}
 */
async function notifyUsers({ userIds = [], title, body, data = {}, type = TYPES.GENERAL, excludeUserId = null } = {}) {
  const excluded = excludeUserId ? String(excludeUserId) : null;
  const targets = [...new Set(userIds.filter(Boolean).map(String))].filter((id) => id !== excluded);

  const result = { socket: 0, sent: 0, failed: 0, pruned: 0, skipped: false };
  if (!targets.length) return result;

  const payload = { type, title, body, data, createdAt: new Date().toISOString() };

  // --- Realtime channel (always attempted, independent of Firebase) ---------
  try {
    targets.forEach((id) => emitToUser(id, 'notification', payload));
    result.socket = targets.length;
  } catch (err) {
    logger.warn('Socket notification failed: %s', err.message);
  }

  // --- Push channel ---------------------------------------------------------
  if (!isFirebaseEnabled()) {
    result.skipped = true;
    logger.debug('Push skipped for %d user(s) — Firebase is not configured', targets.length);
    return result;
  }

  try {
    const users = await User.find({ _id: { $in: targets }, isActive: true }).select('fcmTokens').lean();

    const tokenOwner = new Map();
    users.forEach((user) => {
      (user.fcmTokens || []).forEach((token) => tokenOwner.set(token, String(user._id)));
    });

    const tokens = [...tokenOwner.keys()];
    if (!tokens.length) return result;

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: stringifyData({ ...data, type }),
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    result.sent = response.successCount;
    result.failed = response.failureCount;

    const deadTokens = [];
    response.responses.forEach((res, index) => {
      if (res.success) return;
      const code = res.error?.code;
      if (DEAD_TOKEN_CODES.has(code)) deadTokens.push(tokens[index]);
      else logger.debug('FCM delivery failed (%s): %s', code, res.error?.message);
    });

    if (deadTokens.length) {
      // Prune tokens FCM has told us are permanently invalid.
      const owners = [...new Set(deadTokens.map((t) => tokenOwner.get(t)).filter(Boolean))];
      await User.updateMany({ _id: { $in: owners } }, { $pull: { fcmTokens: { $in: deadTokens } } });
      result.pruned = deadTokens.length;
      logger.info('Pruned %d stale FCM token(s)', deadTokens.length);
    }

    return result;
  } catch (err) {
    // Never rethrow — the caller's write already succeeded.
    logger.warn('Push notification failed: %s', err.message);
    return { ...result, skipped: false, error: err.message };
  }
}

/** Single-recipient convenience wrapper. */
const notifyUser = (userId, options = {}) => notifyUsers({ ...options, userIds: [userId] });

module.exports = { notifyUsers, notifyUser, TYPES, stringifyData };
