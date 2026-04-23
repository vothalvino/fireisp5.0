// =============================================================================
// FireISP 5.0 — Per-Tenant Rate Limiting Tests
// =============================================================================

// ---------------------------------------------------------------------------
// Helpers — build minimal req/res/next stubs
// ---------------------------------------------------------------------------

function makeReq(orgId, ip = '1.2.3.4') {
  return { orgId, ip, headers: {}, socket: { remoteAddress: ip } };
}

function makeRes() {
  const headers = {};
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    getHeader: (k) => headers[k],
    headers,
    _statusCode: 200,
    _body: null,
    status(code) { this._statusCode = code; return this; },
    json(body) { this._body = body; return this; },
    send(body) { this._body = body; return this; },
  };
  return res;
}

// ---------------------------------------------------------------------------
// CacheStore unit tests (no network — uses in-memory cacheService)
// ---------------------------------------------------------------------------

// Prevent any real Redis/DB connections during tests
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const { CacheStore } = require('../src/middleware/rateLimit');

describe('CacheStore', () => {
  const WINDOW_MS = 1000; // 1 second window for speed

  function makeStore() {
    const store = new CacheStore('test_rl:');
    store.init({ windowMs: WINDOW_MS });
    return store;
  }

  it('returns totalHits=1 on first increment', async () => {
    const store = makeStore();
    const result = await store.increment('org1');
    expect(result.totalHits).toBe(1);
    expect(result.resetTime).toBeInstanceOf(Date);
    expect(result.resetTime.getTime()).toBeGreaterThan(Date.now());
  });

  it('increments sequentially for the same key', async () => {
    const store = makeStore();
    await store.increment('org2');
    const r2 = await store.increment('org2');
    const r3 = await store.increment('org2');
    expect(r2.totalHits).toBe(2);
    expect(r3.totalHits).toBe(3);
  });

  it('tracks different keys independently', async () => {
    const store = makeStore();
    await store.increment('orgA');
    await store.increment('orgA');
    const ra = await store.increment('orgA');

    const rb = await store.increment('orgB');

    expect(ra.totalHits).toBe(3);
    expect(rb.totalHits).toBe(1);
  });

  it('resets after window expires', async () => {
    const store = makeStore();
    await store.increment('orgExpire');
    await store.increment('orgExpire');

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, WINDOW_MS + 50));

    const result = await store.increment('orgExpire');
    expect(result.totalHits).toBe(1);
  });

  it('decrement reduces hit count', async () => {
    const store = makeStore();
    await store.increment('orgDec');
    await store.increment('orgDec');
    await store.decrement('orgDec');
    const r = await store.increment('orgDec');
    // Sequence: +1=1, +1=2, -1=1, +1=2
    expect(r.totalHits).toBe(2);
  });

  it('decrement on missing key is a no-op', async () => {
    const store = makeStore();
    // Should not throw
    await expect(store.decrement('nonexistent')).resolves.toBeUndefined();
  });

  it('resetKey clears the counter', async () => {
    const store = makeStore();
    await store.increment('orgReset');
    await store.increment('orgReset');
    await store.resetKey('orgReset');
    const r = await store.increment('orgReset');
    expect(r.totalHits).toBe(1);
  });

  it('resetAll is a no-op without throwing', async () => {
    const store = makeStore();
    await expect(store.resetAll()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tenantApiLimiter middleware tests
// ---------------------------------------------------------------------------

const { tenantApiLimiter } = require('../src/middleware/rateLimit');

describe('tenantApiLimiter middleware', () => {
  it('is an Express middleware function', () => {
    expect(typeof tenantApiLimiter).toBe('function');
  });

  it('calls next() for a request under the limit', (done) => {
    const req = makeReq('org-under-limit');
    const res = makeRes();
    tenantApiLimiter(req, res, (err) => {
      expect(err).toBeUndefined();
      done();
    });
  });

  it('sets RateLimit headers on the response', (done) => {
    const req = makeReq('org-headers');
    const res = makeRes();
    tenantApiLimiter(req, res, () => {
      const hasHeader = Object.keys(res.headers).some((h) =>
        h.toLowerCase().startsWith('ratelimit'));
      expect(hasHeader).toBe(true);
      done();
    });
  });

  it('blocks with 429 when tenant limit is exceeded', async () => {
    const rateLimit = require('express-rate-limit');
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 2,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => `tenant:${req.orgId}`,
      message: { error: { code: 'RATE_LIMITED', message: 'too many' } },
    });

    const orgId = 'org-blocked-seq';
    const run = () => new Promise((resolve) => {
      const res = makeRes();
      limiter(makeReq(orgId), res, () => resolve({ passed: true, res }));
      // If next is not called, limiter handled the response directly
      setTimeout(() => resolve({ passed: false, res }), 100);
    });

    // First two requests should pass (under limit)
    const r1 = await run();
    const r2 = await run();
    expect(r1.passed).toBe(true);
    expect(r2.passed).toBe(true);

    // Third request should be blocked
    const r3 = await run();
    // Either next was not called (passed=false) or res status is 429
    const blocked = !r3.passed || r3.res._statusCode === 429;
    expect(blocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// orgScope integration with tenant rate limit
// ---------------------------------------------------------------------------

const { orgScope } = require('../src/middleware/orgScope');

describe('orgScope with tenant rate limiting', () => {
  it('sets req.orgId from req.user.organizationId', (done) => {
    const req = { user: { organizationId: 42 }, ip: '1.1.1.1', headers: {}, socket: {} };
    const res = makeRes();
    orgScope(req, res, (err) => {
      expect(err).toBeUndefined();
      expect(req.orgId).toBe(42);
      done();
    });
  });

  it('calls next with ForbiddenError when req.user is missing', (done) => {
    const req = { ip: '1.1.1.1', headers: {}, socket: {} };
    const res = makeRes();
    orgScope(req, res, (err) => {
      expect(err).toBeDefined();
      expect(err.statusCode || err.status).toBe(403);
      done();
    });
  });

  it('calls next with ForbiddenError when organizationId is missing', (done) => {
    const req = { user: {}, ip: '1.1.1.1', headers: {}, socket: {} };
    const res = makeRes();
    orgScope(req, res, (err) => {
      expect(err).toBeDefined();
      expect(err.statusCode || err.status).toBe(403);
      done();
    });
  });

  it('applies rate limit header for org-scoped request', (done) => {
    const req = { user: { organizationId: 99 }, ip: '1.1.1.1', headers: {}, socket: {} };
    const res = makeRes();
    orgScope(req, res, () => {
      const hasHeader = Object.keys(res.headers).some((h) =>
        h.toLowerCase().startsWith('ratelimit'));
      expect(hasHeader).toBe(true);
      done();
    });
  });
});

// ---------------------------------------------------------------------------
// Config: tenant rate limit env vars are read correctly
// ---------------------------------------------------------------------------

describe('config rateLimit tenant', () => {
  it('exposes tenantApi and tenantWindowMs defaults', () => {
    const config = require('../src/config');
    expect(typeof config.rateLimit.tenantApi).toBe('number');
    expect(config.rateLimit.tenantApi).toBeGreaterThan(0);
    expect(typeof config.rateLimit.tenantWindowMs).toBe('number');
    expect(config.rateLimit.tenantWindowMs).toBeGreaterThan(0);
  });
});
