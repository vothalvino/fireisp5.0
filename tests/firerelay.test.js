// =============================================================================
// FireISP 5.0 — FireRelay Tests
// =============================================================================
// Tests for FireRelay configuration, standalone middleware, route endpoints,
// validation schemas, enhanced health check, requestId in errors, and
// graceful shutdown improvements.
// =============================================================================

// Mock the database module before any requires
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const request = require('supertest');

// ─────────────────────────────────────────────────────────────────────────────
// FireRelay Config
// ─────────────────────────────────────────────────────────────────────────────
describe('FireRelay Config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    // Clear module cache so config re-reads env
    jest.resetModules();
  });

  test('defaults to standalone mode', () => {
    delete process.env.FIRERELAY_MODE;
    const config = require('../src/config/firerelay');
    expect(config.mode).toBe('standalone');
  });

  test('reads master mode from env', () => {
    process.env.FIRERELAY_MODE = 'master';
    const config = require('../src/config/firerelay');
    expect(config.mode).toBe('master');
  });

  test('reads worker mode from env', () => {
    process.env.FIRERELAY_MODE = 'worker';
    const config = require('../src/config/firerelay');
    expect(config.mode).toBe('worker');
  });

  test('is case-insensitive', () => {
    process.env.FIRERELAY_MODE = 'Master';
    const config = require('../src/config/firerelay');
    expect(config.mode).toBe('master');
  });

  test('throws on invalid mode', () => {
    process.env.FIRERELAY_MODE = 'invalid';
    expect(() => require('../src/config/firerelay')).toThrow('Invalid FIRERELAY_MODE');
  });

  test('parses FIRERELAY_NODES JSON array', () => {
    process.env.FIRERELAY_MODE = 'master';
    process.env.FIRERELAY_NODES = '["https://node2.fireisp.com","https://node3.fireisp.com"]';
    const config = require('../src/config/firerelay');
    expect(config.nodes).toEqual(['https://node2.fireisp.com', 'https://node3.fireisp.com']);
  });

  test('returns empty array for empty FIRERELAY_NODES', () => {
    process.env.FIRERELAY_MODE = 'master';
    process.env.FIRERELAY_NODES = '[]';
    const config = require('../src/config/firerelay');
    expect(config.nodes).toEqual([]);
  });

  test('returns empty array for invalid JSON in FIRERELAY_NODES', () => {
    process.env.FIRERELAY_MODE = 'master';
    process.env.FIRERELAY_NODES = 'not-json';
    const config = require('../src/config/firerelay');
    expect(config.nodes).toEqual([]);
  });

  test('filters non-string entries from FIRERELAY_NODES', () => {
    process.env.FIRERELAY_MODE = 'master';
    process.env.FIRERELAY_NODES = '["https://node2.fireisp.com", 123, null, ""]';
    const config = require('../src/config/firerelay');
    expect(config.nodes).toEqual(['https://node2.fireisp.com']);
  });

  test('reads numeric settings with defaults', () => {
    delete process.env.FIRERELAY_HEALTH_INTERVAL;
    delete process.env.FIRERELAY_REQUEST_TIMEOUT;
    delete process.env.FIRERELAY_MAX_RETRIES;
    delete process.env.FIRERELAY_MAX_CLIENTS;
    delete process.env.FIRERELAY_MAX_DEVICES;
    delete process.env.FIRERELAY_AUTO_INCREMENT_OFFSET;
    const config = require('../src/config/firerelay');
    expect(config.healthInterval).toBe(30000);
    expect(config.requestTimeout).toBe(5000);
    expect(config.maxRetries).toBe(3);
    expect(config.maxClients).toBe(10000);
    expect(config.maxDevices).toBe(3000);
    expect(config.autoIncrementOffset).toBe(1);
  });

  test('reads worker-specific settings', () => {
    process.env.FIRERELAY_MODE = 'worker';
    process.env.FIRERELAY_MASTER_URL = 'https://master.fireisp.com';
    process.env.FIRERELAY_NODE_ID = 'node2';
    process.env.FIRERELAY_AUTO_INCREMENT_OFFSET = '10000001';
    const config = require('../src/config/firerelay');
    expect(config.masterUrl).toBe('https://master.fireisp.com');
    expect(config.nodeId).toBe('node2');
    expect(config.autoIncrementOffset).toBe(10000001);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FireRelay Middleware
// ─────────────────────────────────────────────────────────────────────────────
describe('FireRelay Middleware', () => {
  afterEach(() => {
    jest.resetModules();
  });

  test('calls next() immediately in standalone mode (default)', () => {
    // Default env is standalone
    const { firerelay } = require('../src/middleware/firerelay');
    const req = {};
    const res = {};
    const next = jest.fn();

    firerelay(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.firerelayMode).toBeUndefined();
  });

  test('calls next() in worker mode', () => {
    jest.resetModules();
    // Override the config module for worker mode
    jest.doMock('../src/config/firerelay', () => ({ mode: 'worker', nodeId: 'node2' }));
    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      child: jest.fn().mockReturnValue({ info: jest.fn() }),
    }));
    const { firerelay } = require('../src/middleware/firerelay');
    const req = {};
    const res = {};
    const next = jest.fn();

    firerelay(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.firerelayMode).toBeUndefined();
  });

  test('sets req.firerelayMode in master mode and calls next()', () => {
    jest.resetModules();
    jest.doMock('../src/config/firerelay', () => ({ mode: 'master', nodeId: '' }));
    jest.doMock('../src/utils/logger', () => ({
      info: jest.fn(),
      child: jest.fn().mockReturnValue({ info: jest.fn() }),
    }));
    const { firerelay } = require('../src/middleware/firerelay');
    const req = {};
    const res = {};
    const next = jest.fn();

    firerelay(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.firerelayMode).toBe('master');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FireRelay Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────
describe('FireRelay Validation Schemas', () => {
  const { validate } = require('../src/middleware/validate');
  const { firerelayNode, firerelayNodeUpdate } = require('../src/middleware/schemas/firerelay');

  function mockReqRes(body) {
    return {
      req: { body },
      res: {},
      next: jest.fn(),
    };
  }

  describe('firerelayNode (create)', () => {
    test('passes with valid data', () => {
      const { req, res, next } = mockReqRes({
        id: 'node2',
        api_url: 'https://node2.fireisp.com',
      });
      validate(firerelayNode)(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    test('fails when id is missing', () => {
      const { req, res, next } = mockReqRes({ api_url: 'https://node2.fireisp.com' });
      validate(firerelayNode)(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });

    test('fails when api_url is missing', () => {
      const { req, res, next } = mockReqRes({ id: 'node2' });
      validate(firerelayNode)(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });

    test('fails when id exceeds max length', () => {
      const { req, res, next } = mockReqRes({
        id: 'a'.repeat(65),
        api_url: 'https://node2.fireisp.com',
      });
      validate(firerelayNode)(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });
  });

  describe('firerelayNodeUpdate', () => {
    test('passes with valid status update', () => {
      const { req, res, next } = mockReqRes({ status: 'draining' });
      validate(firerelayNodeUpdate)(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    test('fails on invalid status enum', () => {
      const { req, res, next } = mockReqRes({ status: 'invalid' });
      validate(firerelayNodeUpdate)(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });

    test('passes with numeric metrics', () => {
      const { req, res, next } = mockReqRes({
        client_count: 500,
        device_count: 100,
        cpu_percent: 45.3,
        memory_percent: 62.1,
      });
      validate(firerelayNodeUpdate)(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    test('fails when cpu_percent exceeds 100', () => {
      const { req, res, next } = mockReqRes({ cpu_percent: 150 });
      validate(firerelayNodeUpdate)(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 422 }));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Enhanced Health Check
// ─────────────────────────────────────────────────────────────────────────────
describe('Enhanced Health Check', () => {
  const app = require('../src/app');

  test('GET /health returns basic info with relay mode', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBe('5.0.0');
    expect(res.body.relay).toBe('standalone');
    expect(res.body.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toBeDefined();
  });

  test('GET /health?detail=true includes memory info', async () => {
    const db = require('../src/config/database');
    db.query.mockResolvedValueOnce([[{ connected: 1 }]]);

    const res = await request(app).get('/health?detail=true');
    expect(res.status).toBe(200);
    expect(res.body.memory).toBeDefined();
    expect(res.body.memory.rss).toBeGreaterThan(0);
    expect(res.body.memory.heapUsed).toBeGreaterThan(0);
    expect(res.body.memory.heapTotal).toBeGreaterThan(0);
  });

  test('GET /health?detail=true includes DB latency on success', async () => {
    const db = require('../src/config/database');
    db.query.mockResolvedValueOnce([[{ connected: 1 }]]);

    const res = await request(app).get('/health?detail=true');
    expect(res.status).toBe(200);
    expect(res.body.db).toBeDefined();
    expect(res.body.db.connected).toBe(true);
    expect(res.body.db.latencyMs).toBeGreaterThanOrEqual(0);
  });

  test('GET /health?detail=true returns degraded on DB failure', async () => {
    const db = require('../src/config/database');
    db.query.mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app).get('/health?detail=true');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db.connected).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RequestId in Error Responses
// ─────────────────────────────────────────────────────────────────────────────
describe('RequestId in Error Responses', () => {
  const app = require('../src/app');

  test('404 response includes requestId', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.requestId).toBeDefined();
    expect(typeof res.body.error.requestId).toBe('string');
  });

  test('422 validation error includes requestId', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.requestId).toBeDefined();
  });

  test('401 auth error includes requestId', async () => {
    const res = await request(app).get('/api/clients');
    expect(res.status).toBe(401);
    expect(res.body.error.requestId).toBeDefined();
  });

  test('requestId matches X-Request-Id header', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  test('custom X-Request-Id header is reflected in error response', async () => {
    const customId = 'my-trace-id-12345';
    const res = await request(app)
      .get('/api/nonexistent')
      .set('X-Request-Id', customId);
    expect(res.body.error.requestId).toBe(customId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FireRelay Models
// ─────────────────────────────────────────────────────────────────────────────
describe('FireRelay Models', () => {
  test('FireRelayNode has correct tableName and fillable', () => {
    const FireRelayNode = require('../src/models/FireRelayNode');
    expect(FireRelayNode.tableName).toBe('firerelay_nodes');
    expect(FireRelayNode.fillable).toContain('id');
    expect(FireRelayNode.fillable).toContain('api_url');
    expect(FireRelayNode.fillable).toContain('status');
    expect(FireRelayNode.fillable).toContain('client_count');
    expect(FireRelayNode.hasOrgScope).toBe(false);
  });

  test('FireRelayClientRouting has correct tableName and fillable', () => {
    const FireRelayClientRouting = require('../src/models/FireRelayClientRouting');
    expect(FireRelayClientRouting.tableName).toBe('firerelay_client_routing');
    expect(FireRelayClientRouting.fillable).toContain('client_id');
    expect(FireRelayClientRouting.fillable).toContain('node_id');
    expect(FireRelayClientRouting.hasOrgScope).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FireRelay Route — /api/firerelay/health
// ─────────────────────────────────────────────────────────────────────────────
describe('FireRelay Route — /api/firerelay/health', () => {
  const db = require('../src/config/database');
  const app = require('../src/app');

  beforeEach(() => jest.clearAllMocks());

  test('GET /api/firerelay/health returns node metrics (no auth required)', async () => {
    db.query
      .mockResolvedValueOnce([[{ cnt: 100 }]])    // clients
      .mockResolvedValueOnce([[{ cnt: 25 }]])     // devices
      .mockResolvedValueOnce([[{ size_mb: 512 }]]); // db size

    const res = await request(app).get('/api/firerelay/health');
    expect(res.status).toBe(200);
    expect(res.body.node_id).toBeDefined();
    expect(res.body.mode).toBe('standalone');
    expect(res.body.status).toBe('active');
    expect(res.body.client_count).toBe(100);
    expect(res.body.device_count).toBe(25);
    expect(res.body.db_size_mb).toBe(512);
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(res.body.timestamp).toBeDefined();
    expect(typeof res.body.cpu_percent).toBe('number');
    expect(typeof res.body.memory_percent).toBe('number');
  });

  test('GET /api/firerelay/health returns zeros if DB fails', async () => {
    db.query.mockRejectedValueOnce(new Error('DB down'));

    const res = await request(app).get('/api/firerelay/health');
    expect(res.status).toBe(200);
    expect(res.body.client_count).toBe(0);
    expect(res.body.device_count).toBe(0);
    expect(res.body.db_size_mb).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FireRelay Route — /api/firerelay/nodes (auth-protected)
// ─────────────────────────────────────────────────────────────────────────────
describe('FireRelay Route — /api/firerelay/nodes', () => {
  const app = require('../src/app');

  test('GET /api/firerelay/nodes without auth returns 401', async () => {
    const res = await request(app).get('/api/firerelay/nodes');
    expect(res.status).toBe(401);
  });

  test('POST /api/firerelay/nodes without auth returns 401', async () => {
    const res = await request(app)
      .post('/api/firerelay/nodes')
      .send({ id: 'node2', api_url: 'https://node2.fireisp.com' });
    expect(res.status).toBe(401);
  });

  test('PUT /api/firerelay/nodes/node2 without auth returns 401', async () => {
    const res = await request(app)
      .put('/api/firerelay/nodes/node2')
      .send({ status: 'active' });
    expect(res.status).toBe(401);
  });

  test('DELETE /api/firerelay/nodes/node2 without auth returns 401', async () => {
    const res = await request(app)
      .delete('/api/firerelay/nodes/node2');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FireRelay Middleware Helpers
// ─────────────────────────────────────────────────────────────────────────────
describe('FireRelay Middleware Helpers', () => {
  const { extractClientId, isFanOutRequest } = require('../src/middleware/firerelay');

  describe('extractClientId()', () => {
    test('extracts id from /api/clients/123', () => {
      expect(extractClientId('/api/clients/123')).toBe(123);
    });

    test('extracts id from /api/v1/clients/456', () => {
      expect(extractClientId('/api/v1/clients/456')).toBe(456);
    });

    test('returns null for collection path', () => {
      expect(extractClientId('/api/clients')).toBeNull();
    });

    test('returns null for non-client paths', () => {
      expect(extractClientId('/api/invoices/123')).toBeNull();
    });

    test('returns null for client path with trailing slash', () => {
      expect(extractClientId('/api/clients/')).toBeNull();
    });
  });

  describe('isFanOutRequest()', () => {
    test('returns true for GET /api/clients', () => {
      expect(isFanOutRequest('GET', '/api/clients')).toBe(true);
    });

    test('returns true for GET /api/v1/clients', () => {
      expect(isFanOutRequest('GET', '/api/v1/clients')).toBe(true);
    });

    test('returns true for GET /api/clients?search=John', () => {
      expect(isFanOutRequest('GET', '/api/clients?search=John')).toBe(true);
    });

    test('returns false for POST /api/clients', () => {
      expect(isFanOutRequest('POST', '/api/clients')).toBe(false);
    });

    test('returns false for GET /api/clients/123', () => {
      expect(isFanOutRequest('GET', '/api/clients/123')).toBe(false);
    });

    test('returns false for GET /api/invoices', () => {
      expect(isFanOutRequest('GET', '/api/invoices')).toBe(false);
    });
  });
});
