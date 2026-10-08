/** Jest configuration — integration tests run against an in-memory MongoDB. */
module.exports = {
  // See tests/setup/jest.environment.js — works around Node >= 22 exposing a
  // throwing `localStorage` global that breaks the stock node environment.
  testEnvironment: '<rootDir>/tests/setup/jest.environment.js',
  rootDir: __dirname,
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  // --runInBand is enforced by the npm scripts: every suite shares one
  // mongodb-memory-server instance per worker, so parallel workers would
  // fight over the same port range.
  testTimeout: 60000,
  verbose: true,
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/config/swagger.js',
    '!src/server.js',
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/'],
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: 1,
};
