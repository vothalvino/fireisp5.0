/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/src/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js', '!src/scripts/**'],
  coverageDirectory: 'coverage',
  testTimeout: 15000,
  coverageThreshold: {
    'src/services/': {
      lines: 70,
      branches: 50,
    },
    'src/middleware/': {
      lines: 70,
      branches: 50,
    },
  },
};
