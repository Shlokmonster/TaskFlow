'use strict';

/**
 * Firebase Admin — lazily initialised and completely optional.
 *
 * The whole app must run locally with zero Firebase configuration: every entry
 * point here returns a safe negative instead of throwing, and the failure is
 * logged exactly once so it cannot spam the console on every request.
 */

const fs = require('fs');
const admin = require('firebase-admin');

const env = require('./env');
const logger = require('./logger');

let initialized = false;
let attempted = false;
let warned = false;

function loadCredentials() {
  const creds = env.firebaseCredentials();
  if (!creds) return null;

  if (creds.source === 'file') {
    if (!fs.existsSync(creds.path)) {
      logger.warn('FIREBASE_SERVICE_ACCOUNT_PATH points to a missing file: %s', creds.path);
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(creds.path, 'utf8'));
    } catch (err) {
      logger.warn('Could not parse the Firebase service account file: %s', err.message);
      return null;
    }
  }

  return { projectId: creds.projectId, clientEmail: creds.clientEmail, privateKey: creds.privateKey };
}

/**
 * Initialise the Admin SDK once. Returns the app instance, or null when
 * Firebase is not configured / could not be initialised.
 */
function initFirebase() {
  if (initialized) return admin.app();
  if (attempted) return null; // don't retry a failed init on every request

  attempted = true;

  try {
    const credentials = loadCredentials();
    if (!credentials) {
      if (!warned) {
        warned = true;
        logger.warn('Firebase credentials not configured — push notifications and Firebase login are disabled. The API is fully functional without them.');
      }
      return null;
    }

    if (admin.apps.length) {
      initialized = true;
      return admin.app();
    }

    admin.initializeApp({ credential: admin.credential.cert(credentials) });
    initialized = true;
    logger.info('Firebase Admin initialised — push notifications enabled');
    return admin.app();
  } catch (err) {
    if (!warned) {
      warned = true;
      logger.warn('Firebase Admin failed to initialise (%s) — continuing without push notifications.', err.message);
    }
    return null;
  }
}

function isFirebaseEnabled() {
  return Boolean(initFirebase());
}

/** @returns {import('firebase-admin').messaging.Messaging} */
function getMessaging() {
  if (!initFirebase()) throw new Error('Firebase Admin is not initialised');
  return admin.messaging();
}

/**
 * Verify a Firebase ID token.
 * @param {string} idToken
 * @returns {Promise<object|null>} decoded token, or null when Firebase is off.
 */
async function verifyIdToken(idToken) {
  if (!initFirebase()) return null;
  return admin.auth().verifyIdToken(idToken);
}

module.exports = { initFirebase, isFirebaseEnabled, getMessaging, verifyIdToken, admin };
