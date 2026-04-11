// =============================================================================
// FireISP 5.0 — Request Logger Middleware Tests
// =============================================================================

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../src/utils/logger');
const { requestLogger } = require('../src/middleware/requestLogger');

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
