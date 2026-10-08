'use strict';

/**
 * Custom Jest environment.
 *
 * Node >= 22 exposes `localStorage` / `sessionStorage` as accessors that throw
 * `SecurityError: Cannot initialize local storage without a --localstorage-file
 * path` unless the process was started with `--localstorage-file`. On Node 25
 * that global exists by default, and `jest-environment-node` copies it into the
 * sandbox and reads it — which aborts the entire suite before a single test runs.
 *
 * Replacing the accessors with plain values up front (they are configurable)
 * lets the stock environment set up normally while changing nothing for the code
 * under test, which never touches browser storage.
 */

for (const key of ['localStorage', 'sessionStorage']) {
  try {
    // Reading triggers the SecurityError on Node >= 22 when webstorage is on.
    void globalThis[key];
  } catch {
    Object.defineProperty(globalThis, key, { value: undefined, configurable: true, writable: true });
  }
}

const nodeEnvironmentModule = require('jest-environment-node');
const NodeEnvironment = nodeEnvironmentModule.default || nodeEnvironmentModule;

class TaskFlowTestEnvironment extends NodeEnvironment {}

module.exports = TaskFlowTestEnvironment;
module.exports.default = TaskFlowTestEnvironment;
