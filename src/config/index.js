// =============================================================================
// FireISP 5.0 — Application Configuration
// =============================================================================

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appUrl: process.env.APP_URL || 'http://localhost:3000',

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-to-a-random-64-char-string',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  log: {
    level: process.env.LOG_LEVEL || 'debug',
  },
};
