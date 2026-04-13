// =============================================================================
// FireISP 5.0 — Config & Env Validation Tests
// =============================================================================

describe('config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('exports default config values', () => {
    delete process.env.NODE_ENV;
    delete process.env.PORT;
    const config = require('../src/config');
    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.jwt.secret).toBe('change-me-to-a-random-64-char-string');
    expect(config.requestTimeoutMs).toBe(30000);
  });

  test('feature flags default to true', () => {
    const config = require('../src/config');
    expect(config.features.cfdi).toBe(true);
    expect(config.features.radius).toBe(true);
    expect(config.features.twoFactor).toBe(true);
    expect(config.features.webhooks).toBe(true);
    expect(config.features.snmp).toBe(true);
  });

  test('feature flags can be disabled via env', () => {
    process.env.FEATURE_CFDI = 'false';
    process.env.FEATURE_RADIUS = 'false';
    process.env.FEATURE_2FA = '0';
    jest.resetModules();
    const config = require('../src/config');
    expect(config.features.cfdi).toBe(false);
    expect(config.features.radius).toBe(false);
    expect(config.features.twoFactor).toBe(false);
  });

  test('requestTimeoutMs can be overridden', () => {
    process.env.REQUEST_TIMEOUT_MS = '60000';
    jest.resetModules();
    const config = require('../src/config');
    expect(config.requestTimeoutMs).toBe(60000);
  });
});

describe('validateEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('warns in development when JWT_SECRET is default', () => {
    process.env.NODE_ENV = 'development';
    jest.resetModules();
    const config = require('../src/config');
    const mockLogger = { warn: jest.fn() };
    config.validateEnv(mockLogger);
    expect(mockLogger.warn).toHaveBeenCalled();
    const warnMsg = mockLogger.warn.mock.calls.map(c => c[0]).join(' ');
    expect(warnMsg).toContain('JWT_SECRET');
  });

  test('throws in production when JWT_SECRET is default', () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const config = require('../src/config');
    expect(() => config.validateEnv(null)).toThrow('Fatal configuration errors');
  });

  test('throws in production when JWT_SECRET is too short', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'short';
    process.env.DB_HOST = 'localhost';
    process.env.DB_NAME = 'fireisp';
    jest.resetModules();
    const config = require('../src/config');
    expect(() => config.validateEnv(null)).toThrow('JWT_SECRET');
  });

  test('throws in production when DB_HOST is missing', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-very-long-secret-that-is-at-least-32-characters-long';
    delete process.env.DB_HOST;
    process.env.DB_NAME = 'fireisp';
    jest.resetModules();
    const config = require('../src/config');
    expect(() => config.validateEnv(null)).toThrow('DB_HOST');
  });

  test('does not throw in production with valid config', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-very-long-secret-that-is-at-least-32-characters-long';
    process.env.DB_HOST = 'localhost';
    process.env.DB_NAME = 'fireisp';
    jest.resetModules();
    const config = require('../src/config');
    expect(() => config.validateEnv(null)).not.toThrow();
  });
});
