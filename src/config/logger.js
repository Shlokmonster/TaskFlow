'use strict';

/**
 * Lightweight leveled logger.
 *
 * Deliberately dependency-free and it reads `process.env` directly (not
 * `config/env`) so it can be required by the env validator itself without a
 * circular import.
 */

const util = require('util');

const LEVELS = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };

const configured = String(process.env.LOG_LEVEL || 'info').toLowerCase();
const threshold = Object.prototype.hasOwnProperty.call(LEVELS, configured)
  ? LEVELS[configured]
  : LEVELS.info;

const isTest = process.env.NODE_ENV === 'test';

const timestamp = () => new Date().toISOString();

function write(level, stream, args) {
  if (LEVELS[level] > threshold) return;
  if (isTest && LEVELS[level] > LEVELS.warn) return; // keep test output readable
  // util.format so callers can use %s/%d placeholders and pass an Error as a
  // trailing argument (it is inspected, keeping the stack).
  stream(`[${timestamp()}] [${level.toUpperCase()}]`, util.format(...args));
}

const logger = {
  error: (...args) => write('error', console.error, args),
  warn: (...args) => write('warn', console.warn, args),
  info: (...args) => write('info', console.info, args),
  http: (...args) => write('http', console.log, args),
  debug: (...args) => write('debug', console.debug, args),
  /** morgan stream adapter */
  stream: { write: (message) => write('http', console.log, [String(message).trim()]) },
};

module.exports = logger;
