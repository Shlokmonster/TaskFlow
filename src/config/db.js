'use strict';

const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

// Fail fast on queries that were not declared in the schema — a typo in a
// filter should be an error, not a silent full-collection match.
mongoose.set('strictQuery', true);

let connected = false;
let listenersBound = false;
let closing = false;

async function connectDB(uri = env.MONGODB_URI) {
  if (connected && mongoose.connection.readyState === 1) return mongoose.connection;

  // Bind once — connectDB may run again after a drop, and duplicate listeners
  // would log every event twice.
  if (!listenersBound) {
    mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
    mongoose.connection.on('error', (err) => logger.error('MongoDB error:', err.message));
    mongoose.connection.on('disconnected', () => {
      // A disconnect we asked for is not a problem worth warning about.
      if (closing) logger.debug('MongoDB disconnected');
      else logger.warn('MongoDB disconnected');
      closing = false;
    });
    mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
    listenersBound = true;
  }

  closing = false;

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: env.IS_PROD ? 20 : 10,
    autoIndex: !env.IS_PROD, // build indexes automatically outside production
  });

  connected = true;
  return mongoose.connection;
}

async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  closing = true;
  await mongoose.connection.close();
  connected = false;
  logger.info('MongoDB connection closed');
}

/** Human readable connection state, used by the /health endpoint. */
function dbState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting', 'uninitialized'];
  return states[mongoose.connection.readyState] || 'unknown';
}

module.exports = { connectDB, disconnectDB, dbState, mongoose };
