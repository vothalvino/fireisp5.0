/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/src/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js', '!src/scripts/**'],
  coverageDirectory: 'coverage',
  testTimeout: 15000,
  // Cap workers OFF-CI to avoid over-subscribing a busy dev machine. jest defaults
  // to cpus-1 workers; on a loaded box that starves a worker long enough for a whole
  // mock-heavy test file (e.g. the SNMP poller/trap suites — which mock net-snmp, so
  // this was never a real UDP-socket issue) to blow the 15s timeout intermittently.
  // CI runners aren't over-subscribed and are green, so leave their default untouched.
  ...(process.env.CI ? {} : { maxWorkers: '50%' }),
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
