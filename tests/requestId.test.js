// =============================================================================
// FireISP 5.0 — Request ID Middleware Tests
// =============================================================================

const { requestId } = require('../src/middleware/requestId');

// Mock the logger
jest.mock('../src/utils/logger', () => ({
  child: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() }),
}));

describe('requestId middleware', () => {
  test('generates a UUID when no X-Request-Id header is present', () => {
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.id).toBeDefined();
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(req.log).toBeDefined();
    expect(next).toHaveBeenCalled();
  });

  test('uses X-Request-Id header when present', () => {
    const req = { headers: { 'x-request-id': 'my-custom-id-123' } };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    requestId(req, res, next);

    expect(req.id).toBe('my-custom-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'my-custom-id-123');
    expect(next).toHaveBeenCalled();
  });

  test('creates a child logger with the request ID', () => {
    const logger = require('../src/utils/logger');
    const req = { headers: {} };
    const res = { setHeader: jest.fn() };
    const next = jest.fn();

    requestId(req, res, next);

    expect(logger.child).toHaveBeenCalledWith({ requestId: req.id });
    expect(req.log).toBeDefined();
  });
});
