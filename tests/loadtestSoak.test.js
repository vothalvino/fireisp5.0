// =============================================================================
// FireISP 5.0 — Soak Test Unit Tests (P1.6)
// =============================================================================
// Tests for the soak test script's exportable helper: probeRssMb.
// The main() integration is not exercised here because it requires a live
// server + autocannon — that is covered by the manual soak test procedure.
// =============================================================================

const http  = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// Mock http/https so we can simulate /health?detail=true responses without
// a real server.
// ---------------------------------------------------------------------------
jest.mock('http');
jest.mock('https');

// Mock dotenv so we don't need a .env file.
jest.mock('dotenv', () => ({ config: jest.fn() }));

// Mock autocannon (not used by probeRssMb but imported at module level).
jest.mock('autocannon', () => {
  const fn = jest.fn();
  fn.track = jest.fn();
  return fn;
});

// Mock the logger.
jest.mock('../src/utils/logger', () => {
  const mockLogger = {
    info:  jest.fn(),
    error: jest.fn(),
    warn:  jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  return mockLogger;
});

// ---------------------------------------------------------------------------
// Helper to make http.request return a fake response.
// ---------------------------------------------------------------------------
function makeHttpMock(statusCode, body) {
  const EventEmitter = require('events');
  const mockReq = new EventEmitter();
  mockReq.write = jest.fn();
  mockReq.end   = jest.fn();

  const mockRes = new EventEmitter();
  mockRes.statusCode = statusCode;

  http.request.mockImplementation((_opts, cb) => {
    cb(mockRes);
    // Emit data + end on the next tick so the Promise resolves.
    setImmediate(() => {
      mockRes.emit('data', Buffer.from(JSON.stringify(body)));
      mockRes.emit('end');
    });
    return mockReq;
  });
  return { mockReq, mockRes };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadtest-soak: probeRssMb', () => {
  let probeRssMb;

  beforeAll(() => {
    // Must be required after mocks are in place.
    ({ probeRssMb } = require('../src/scripts/loadtest-soak'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns RSS value when /health?detail=true responds with memory.rss', async () => {
    makeHttpMock(200, { status: 'ok', memory: { rss: 128, heapUsed: 60, heapTotal: 80 } });

    const result = await probeRssMb();
    expect(result).toBe(128);
  });

  test('returns null when response has no memory field', async () => {
    makeHttpMock(200, { status: 'ok' });

    const result = await probeRssMb();
    expect(result).toBeNull();
  });

  test('returns null when the HTTP request throws a network error', async () => {
    const EventEmitter = require('events');
    const mockReq = new EventEmitter();
    mockReq.write = jest.fn();
    mockReq.end   = jest.fn();

    http.request.mockImplementation((_opts, _cb) => {
      setImmediate(() => mockReq.emit('error', new Error('ECONNREFUSED')));
      return mockReq;
    });

    const result = await probeRssMb();
    expect(result).toBeNull();
  });

  test('returns null when response body is not valid JSON', async () => {
    const EventEmitter = require('events');
    const mockReq = new EventEmitter();
    mockReq.write = jest.fn();
    mockReq.end   = jest.fn();

    const mockRes = new EventEmitter();
    mockRes.statusCode = 200;

    http.request.mockImplementation((_opts, cb) => {
      cb(mockRes);
      setImmediate(() => {
        mockRes.emit('data', Buffer.from('not-json'));
        mockRes.emit('end');
      });
      return mockReq;
    });

    const result = await probeRssMb();
    expect(result).toBeNull();
  });

  test('returns null when memory.rss is not a number', async () => {
    makeHttpMock(200, { status: 'ok', memory: { rss: 'not-a-number' } });

    const result = await probeRssMb();
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Configuration defaults
// ---------------------------------------------------------------------------

describe('loadtest-soak: configuration defaults', () => {
  test('exports a main function', () => {
    const soak = require('../src/scripts/loadtest-soak');
    expect(typeof soak.main).toBe('function');
  });

  test('exports a probeRssMb function', () => {
    const soak = require('../src/scripts/loadtest-soak');
    expect(typeof soak.probeRssMb).toBe('function');
  });
});
