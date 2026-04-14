// =============================================================================
// FireISP 5.0 — FireRelay Middleware Tests
// =============================================================================

jest.mock('../src/config/firerelay', () => ({
  mode: 'standalone',
  nodes: [],
  healthInterval: 30000,
  requestTimeout: 5000,
  maxRetries: 3,
  masterUrl: '',
  nodeId: '',
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const relayConfig = require('../src/config/firerelay');
const { firerelay, extractClientId, isFanOutRequest } = require('../src/middleware/firerelay');

describe('extractClientId', () => {
  test('returns id from /api/clients/123', () => {
    expect(extractClientId('/api/clients/123')).toBe(123);
  });

  test('returns id from /api/v1/clients/456', () => {
    expect(extractClientId('/api/v1/clients/456')).toBe(456);
  });

  test('returns null for non-client paths', () => {
    expect(extractClientId('/api/invoices/99')).toBeNull();
  });

  test('returns null for client list paths without id', () => {
    expect(extractClientId('/api/clients')).toBeNull();
    expect(extractClientId('/api/clients/')).toBeNull();
  });
});

describe('isFanOutRequest', () => {
  test('returns true for GET /api/clients', () => {
    expect(isFanOutRequest('GET', '/api/clients')).toBe(true);
  });

  test('returns true for GET /api/v1/clients', () => {
    expect(isFanOutRequest('GET', '/api/v1/clients')).toBe(true);
  });

  test('returns true for GET /api/clients?page=1', () => {
    expect(isFanOutRequest('GET', '/api/clients?page=1')).toBe(true);
  });

  test('returns false for POST /api/clients', () => {
    expect(isFanOutRequest('POST', '/api/clients')).toBe(false);
  });

  test('returns false for GET /api/clients/123', () => {
    expect(isFanOutRequest('GET', '/api/clients/123')).toBe(false);
  });
});

describe('firerelay middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls next() in standalone mode', () => {
    relayConfig.mode = 'standalone';
    const req = {};
    const res = {};
    const next = jest.fn();
    firerelay(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.firerelayMode).toBeUndefined();
  });

  test('calls next() in worker mode', () => {
    relayConfig.mode = 'worker';
    const req = {};
    const res = {};
    const next = jest.fn();
    firerelay(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.firerelayMode).toBeUndefined();
  });

  test('sets req.firerelayMode to master in master mode', () => {
    relayConfig.mode = 'master';
    const req = {};
    const res = {};
    const next = jest.fn();
    firerelay(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.firerelayMode).toBe('master');
  });
});
