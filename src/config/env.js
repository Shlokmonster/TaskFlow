'use strict';

/**
 * Environment loading + validation.
 *
 * Everything the app needs is read once here, validated with Joi, and exported
 * as a frozen object. A misconfigured deployment fails loudly at boot instead
 * of throwing somewhere deep in a request handler.
 */

const path = require('path');
const Joi = require('joi');

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const isTest = process.env.NODE_ENV === 'test';

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(5000),
  API_PREFIX: Joi.string().pattern(/^\//).default('/api'),

  // Required in every environment except test, where an in-memory DB is used.
  MONGODB_URI: Joi.string()
    .pattern(/^mongodb(\+srv)?:\/\//)
    .when('NODE_ENV', { is: 'test', then: Joi.string().default('mongodb://127.0.0.1:27017/taskflow_test'), otherwise: Joi.string().required() }),

  JWT_SECRET: Joi.string()
    .min(16)
    .when('NODE_ENV', {
      is: 'test',
      then: Joi.string().default('taskflow-test-secret-do-not-use-in-production'),
      otherwise: Joi.string().required(),
    }),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_ISSUER: Joi.string().default('taskflow'),
  JWT_AUDIENCE: Joi.string().default('taskflow-api'),
  BCRYPT_SALT_ROUNDS: Joi.number().integer().min(4).max(15).when('NODE_ENV', { is: 'test', then: Joi.number().default(4), otherwise: Joi.number().default(12) }),

  CORS_ORIGIN: Joi.string().default('*'),
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(1000).default(15 * 60 * 1000),
  RATE_LIMIT_MAX: Joi.number().integer().min(1).default(100),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().min(1).default(10),
  JSON_BODY_LIMIT: Joi.string().default('1mb'),

  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'http', 'debug').default('info'),

  // Firebase is optional — absence is not an error.
  FIREBASE_PROJECT_ID: Joi.string().allow('', null).default(''),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('', null).default(''),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('', null).default(''),
  FIREBASE_SERVICE_ACCOUNT_PATH: Joi.string().allow('', null).default(''),
}).unknown(true);

const { value, error } = schema.validate(process.env, { abortEarly: false, convert: true });

if (error) {
  const details = error.details.map((d) => `  • ${d.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`\n✖ Invalid environment configuration:\n${details}\n\nCopy .env.example to .env and fill in the required values.\n`);
  process.exit(1);
}

const env = {
  ...value,
  IS_PROD: value.NODE_ENV === 'production',
  IS_TEST: value.NODE_ENV === 'test',
  IS_DEV: value.NODE_ENV === 'development',
};

/** CORS origin in the shape the `cors` package (and Socket.io) expects. */
env.corsOrigin = () => {
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN.trim() === '*') return true;
  const list = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : true;
};

/** Firebase creds as a plain object, or null when the integration is off. */
env.firebaseCredentials = () => {
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) return { source: 'file', path: env.FIREBASE_SERVICE_ACCOUNT_PATH };
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return {
      source: 'env',
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      // .env files cannot contain real newlines — restore them.
      privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    };
  }
  return null;
};

Object.freeze(env);

module.exports = env;
