'use strict';

/**
 * Runs via jest `setupFiles` — before the test framework and before any
 * application module is required, so `config/env.js` validates against these
 * values rather than the developer's real `.env`.
 */
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

process.env.JWT_SECRET = 'taskflow-test-secret-do-not-use-in-production';
process.env.JWT_EXPIRES_IN = '1h';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/taskflow_test';
// Keep bcrypt cheap so the suite stays fast.
process.env.BCRYPT_SALT_ROUNDS = '4';

// Firebase is intentionally left unconfigured: the app must work without it.
process.env.FIREBASE_PROJECT_ID = '';
process.env.FIREBASE_CLIENT_EMAIL = '';
process.env.FIREBASE_PRIVATE_KEY = '';
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
