// =============================================================================
// FireISP 5.0 — Structured Logger (Pino)
// =============================================================================
// Provides structured JSON logging for development and production.
// Usage:  const logger = require('./utils/logger');
//         logger.info({ clientId: 42 }, 'payment received');
// =============================================================================

const pino = require('pino');
const config = require('../config');

// Sensitive field paths that are redacted before any log line is written.
// Uses Pino / fast-redact dot-notation. Add new paths here when new secret
// fields are introduced. Wildcards (e.g. '*.password') require the
// fast-redact `strict:false` option — use explicit paths instead.
const REDACT_PATHS = [
  // --- common secret field names at the root of a log object ---------------
  'password',
  'passwd',
  'currentPassword',
  'newPassword',
  'confirmPassword',
  'secret',
  'token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'apiKey',
  'api_key',
  'authorization',
  'privateKey',
  'clientSecret',

  // --- environment variable names (if a config object is ever logged) -------
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'DB_PASSWORD',
  'DB_ROOT_PASSWORD',
  'MYSQL_REPL_PASSWORD',
  'SMTP_PASS',
  'TWILIO_AUTH_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CONEKTA_API_KEY',
  'CONEKTA_WEBHOOK_KEY',
  'PAC_PASSWORD',
  'RADIUS_SECRET',
  'REDIS_PASSWORD',
  'BACKUP_S3_SECRET_KEY',
  'CF_API_TOKEN',
  'SMS_PROVIDER_API_KEY',
  'FIRERELAY_AUTH_TOKEN',

  // --- HTTP request fields (when req/headers are included in a log call) ----
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-webhook-secret"]',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.confirmPassword',
  'req.body.token',
  'req.body.secret',
  'req.body.apiKey',
  'req.body.api_key',
  'req.body.smtp_password',
];

const logger = pino({
  level: config.log.level,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
});

module.exports = logger;
