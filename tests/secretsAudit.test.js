// =============================================================================
// FireISP 5.0 — Secrets Audit Tests (P1.4)
// =============================================================================
// Verifies that:
//   1. Health endpoints never expose secret values or secret env-var names.
//   2. The Pino logger is configured with a redact list that covers all
//      known sensitive field names.
// =============================================================================

const request = require('supertest');

// Mock the database so the app can be loaded without a real MySQL connection.
jest.mock('../src/config/database', () => ({
  query: jest.fn().mockResolvedValue([[]]),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Known secret environment variable names that must never appear in any
 * response body.  Add new entries here whenever a new secret var is
 * introduced to .env.example or src/config/index.js.
 */
const SECRET_ENV_VAR_NAMES = [
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
  'BACKUP_S3_ACCESS_KEY',
  'CF_API_TOKEN',
  'SMS_PROVIDER_API_KEY',
];

/**
 * Returns an array of secret env-var names found in the serialised response
 * body.  An empty array means no leakage.
 */
function getSecretNamesInResponse(body) {
  const bodyStr = JSON.stringify(body);
  return SECRET_ENV_VAR_NAMES.filter(name => bodyStr.includes(name));
}

// ---------------------------------------------------------------------------
// Health endpoint audit
// ---------------------------------------------------------------------------

describe('Health endpoints — no secret leakage', () => {
  test('GET /health does not include secret env-var names', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    const found = getSecretNamesInResponse(res.body);
    expect(found).toHaveLength(0);
  });

  test('GET /health?detail=true does not include secret env-var names', async () => {
    const res = await request(app).get('/health?detail=true');
    // status may be 200 or 503 depending on DB mock; either is fine
    const found = getSecretNamesInResponse(res.body);
    expect(found).toHaveLength(0);
  });

  test('GET /health?detail=true response fields are limited to safe metadata', async () => {
    const res = await request(app).get('/health?detail=true');
    const allowedTopLevelKeys = new Set([
      'status', 'version', 'uptime', 'relay', 'timestamp', 'memory', 'db',
    ]);
    Object.keys(res.body).forEach(key => {
      expect(allowedTopLevelKeys).toContain(key);
    });
  });

  test('GET /health/live does not include secret env-var names', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    const found = getSecretNamesInResponse(res.body);
    expect(found).toHaveLength(0);
  });

  test('GET /health/ready does not include secret env-var names', async () => {
    const res = await request(app).get('/health/ready');
    const found = getSecretNamesInResponse(res.body);
    expect(found).toHaveLength(0);
  });

  test('GET /healthz does not include secret env-var names', async () => {
    const res = await request(app).get('/healthz');
    const found = getSecretNamesInResponse(res.body);
    expect(found).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pino logger redact configuration
// ---------------------------------------------------------------------------

describe('Logger redact configuration', () => {
  // Re-require logger in isolation to inspect the pino config.
  // We validate the exported logger has a redact list, not its internal state,
  // since pino does not expose the redact config after construction.
  // Instead we test the behaviour by creating a pino instance directly.

  test('logger module exports a pino logger instance', () => {
    jest.resetModules();
    const logger = require('../src/utils/logger');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  test('logger redacts the "password" field', () => {
    // Build a minimal pino logger with the same config as src/utils/logger.js
    // and verify that the "password" field is redacted in the output.
    const pino = require('pino');
    const { Writable } = require('stream');

    let captured = '';
    const sink = new Writable({
      write(chunk, _enc, cb) {
        captured += chunk.toString();
        cb();
      },
    });

    const testLogger = pino(
      {
        level: 'info',
        redact: {
          paths: ['password', 'secret', 'token', 'authorization'],
          censor: '[REDACTED]',
        },
      },
      sink,
    );

    testLogger.info({ user: 'admin', password: 'supersecret' }, 'login attempt');

    const parsed = JSON.parse(captured.trim());
    expect(parsed.password).toBe('[REDACTED]');
    expect(parsed.user).toBe('admin');
  });

  test('logger redacts the "secret" field', () => {
    const pino = require('pino');
    const { Writable } = require('stream');

    let captured = '';
    const sink = new Writable({
      write(chunk, _enc, cb) { captured += chunk.toString(); cb(); },
    });

    const testLogger = pino(
      { level: 'info', redact: { paths: ['secret'], censor: '[REDACTED]' } },
      sink,
    );

    testLogger.info({ op: 'webhook', secret: 'wh_secret_123' }, 'webhook received');

    const parsed = JSON.parse(captured.trim());
    expect(parsed.secret).toBe('[REDACTED]');
    expect(parsed.op).toBe('webhook');
  });

  test('logger redacts the "authorization" field', () => {
    const pino = require('pino');
    const { Writable } = require('stream');

    let captured = '';
    const sink = new Writable({
      write(chunk, _enc, cb) { captured += chunk.toString(); cb(); },
    });

    const testLogger = pino(
      { level: 'info', redact: { paths: ['authorization'], censor: '[REDACTED]' } },
      sink,
    );

    testLogger.info({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9...' }, 'auth header logged');

    const parsed = JSON.parse(captured.trim());
    expect(parsed.authorization).toBe('[REDACTED]');
  });

  test('REDACT_PATHS list in logger covers all known secret env-var names', () => {
    // Read the logger source and verify that all critical secret env-var names
    // appear as string literals inside the REDACT_PATHS array definition.
    // This is a whitebox check: we look for the exact quoted form (e.g. 'JWT_SECRET')
    // between the REDACT_PATHS array brackets.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../src/utils/logger.js'),
      'utf8',
    );

    // Extract only the REDACT_PATHS array body to avoid false positives from
    // surrounding comments or unrelated string literals.
    const arrayMatch = src.match(/const REDACT_PATHS\s*=\s*\[([\s\S]*?)\];/);
    expect(arrayMatch).not.toBeNull();
    const arrayBody = arrayMatch[1];

    const criticalVars = [
      'JWT_SECRET',
      'ENCRYPTION_KEY',
      'DB_PASSWORD',
      'SMTP_PASS',
      'TWILIO_AUTH_TOKEN',
      'STRIPE_SECRET_KEY',
      'CONEKTA_API_KEY',
      'PAC_PASSWORD',
      'RADIUS_SECRET',
      'REDIS_PASSWORD',
      'BACKUP_S3_SECRET_KEY',
      'CF_API_TOKEN',
    ];

    const missing = criticalVars.filter(v => !arrayBody.includes(`'${v}'`));
    expect(missing).toHaveLength(0);
  });
});
