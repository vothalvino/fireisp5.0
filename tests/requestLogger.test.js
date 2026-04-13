// =============================================================================
// FireISP 5.0 — Request Logger Middleware Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../src/utils/logger');
const { requestLogger, maskUrl } = require('../src/middleware/requestLogger');

describe('requestLogger middleware', () => {
  test('logs request on finish event', (done) => {
    const req = {
      method: 'GET',
      originalUrl: '/api/clients',
      ip: '127.0.0.1',
      user: { id: 1 },
    };

    const listeners = {};
    const res = {
      statusCode: 200,
      on(event, handler) {
        listeners[event] = handler;
      },
    };

    requestLogger(req, res, () => {});

    // Simulate 'finish' event
    listeners.finish();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: '/api/clients',
        status: 200,
        user_id: 1,
      }),
      expect.stringContaining('GET /api/clients 200'),
    );
    done();
  });

  test('logs 4xx as warn', (done) => {
    const req = { method: 'POST', originalUrl: '/api/auth/login', ip: '127.0.0.1', user: null };
    const listeners = {};
    const res = {
      statusCode: 401,
      on(event, handler) { listeners[event] = handler; },
    };

    requestLogger(req, res, () => {});
    listeners.finish();

    expect(logger.warn).toHaveBeenCalled();
    done();
  });

  test('logs 5xx as error', (done) => {
    const req = { method: 'GET', originalUrl: '/api/crash', ip: '127.0.0.1', user: null };
    const listeners = {};
    const res = {
      statusCode: 500,
      on(event, handler) { listeners[event] = handler; },
    };

    requestLogger(req, res, () => {});
    listeners.finish();

    expect(logger.error).toHaveBeenCalled();
    done();
  });

  test('calls next()', () => {
    const next = jest.fn();
    const req = { method: 'GET', originalUrl: '/', ip: '127.0.0.1' };
    const res = { statusCode: 200, on: jest.fn() };

    requestLogger(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('maskUrl', () => {
  test('masks password query parameter', () => {
    expect(maskUrl('/api/auth?password=secret123')).toBe('/api/auth?password=[REDACTED]');
  });

  test('masks token query parameter', () => {
    expect(maskUrl('/api/verify?token=abc123')).toBe('/api/verify?token=[REDACTED]');
  });

  test('masks api_key query parameter', () => {
    expect(maskUrl('/api/data?api_key=key123&page=1')).toBe('/api/data?api_key=[REDACTED]&page=1');
  });

  test('masks secret query parameter', () => {
    expect(maskUrl('/api?secret=mysecret')).toBe('/api?secret=[REDACTED]');
  });

  test('masks access_token query parameter', () => {
    expect(maskUrl('/api?access_token=tok')).toBe('/api?access_token=[REDACTED]');
  });

  test('masks refresh_token query parameter', () => {
    expect(maskUrl('/api?refresh_token=tok')).toBe('/api?refresh_token=[REDACTED]');
  });

  test('masks multiple sensitive params', () => {
    expect(maskUrl('/api?password=p&token=t')).toBe('/api?password=[REDACTED]&token=[REDACTED]');
  });

  test('leaves non-sensitive params unchanged', () => {
    expect(maskUrl('/api/clients?page=1&limit=50')).toBe('/api/clients?page=1&limit=50');
  });

  test('handles URLs without query string', () => {
    expect(maskUrl('/api/clients')).toBe('/api/clients');
  });

  test('masks sensitive URL in logged output', (done) => {
    const req = {
      method: 'GET',
      originalUrl: '/api/auth?token=secret-value&page=1',
      ip: '127.0.0.1',
      user: null,
    };

    const listeners = {};
    const res = {
      statusCode: 200,
      on(event, handler) { listeners[event] = handler; },
    };

    requestLogger(req, res, () => {});
    listeners.finish();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/auth?token=[REDACTED]&page=1',
      }),
      expect.any(String),
    );
    done();
  });
});
