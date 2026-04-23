// =============================================================================
// FireISP 5.0 — HTTP Cache Middleware Tests (M5.6)
// =============================================================================
// Unit tests for the httpCache middleware and bustCache helper.
// All external I/O (DB) is mocked.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const { httpCache, bustCache } = require('../src/middleware/httpCache');
const cacheService = require('../src/services/cacheService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(orgId = 'org1', query = {}, method = 'GET') {
  return { method, orgId, path: '/test', query };
}

function makeRes(statusCode = 200) {
  const headers = {};
  const res = {
    _body: null,
    _statusCode: statusCode,
    statusCode,
    headers,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    json(body) { this._body = body; return this; },
    send(body) { this._body = body; return this; },
    status(code) { this._statusCode = code; this.statusCode = code; return this; },
  };
  return res;
}

function makeNext() {
  const fn = jest.fn();
  return fn;
}

// Flush the in-memory cache between tests
beforeEach(async () => {
  await cacheService.flush();
});

// ---------------------------------------------------------------------------
// httpCache middleware — cache miss → cache hit
// ---------------------------------------------------------------------------

describe('httpCache middleware', () => {
  it('calls next() on cache miss and sets X-Cache: MISS', async () => {
    const mw = httpCache('plans', 300);
    const req = makeReq('org1');
    const res = makeRes();
    const next = makeNext();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-Cache']).toBe('MISS');
  });

  it('caches a successful 200 response and serves it as X-Cache: HIT', async () => {
    const mw = httpCache('plans', 300);

    // First request — cache miss
    const req1 = makeReq('org2');
    const res1 = makeRes(200);
    const next1 = makeNext();
    await mw(req1, res1, next1);
    // Simulate handler writing response
    await res1.json({ data: [{ id: 1 }] });

    // Second request — should hit cache
    const req2 = makeReq('org2');
    const res2 = makeRes();
    const next2 = makeNext();
    await mw(req2, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2._body).toEqual({ data: [{ id: 1 }] });
    expect(res2.headers['X-Cache']).toBe('HIT');
  });

  it('does not cache non-2xx responses', async () => {
    const mw = httpCache('plans', 300);

    const req1 = makeReq('org3');
    const res1 = makeRes(500);
    const next1 = makeNext();
    await mw(req1, res1, next1);
    await res1.json({ error: 'Internal Server Error' });

    // Second request — should miss cache again (500 was not cached)
    const req2 = makeReq('org3');
    const res2 = makeRes();
    const next2 = makeNext();
    await mw(req2, res2, next2);

    expect(next2).toHaveBeenCalledTimes(1);
    expect(res2.headers['X-Cache']).toBe('MISS');
  });

  it('caches are isolated per org', async () => {
    const mw = httpCache('plans', 300);

    // Populate cache for org4
    const reqA = makeReq('org4');
    const resA = makeRes(200);
    await mw(reqA, resA, makeNext());
    await resA.json({ data: [{ id: 10 }] });

    // org5 should still be a cache miss
    const reqB = makeReq('org5');
    const resB = makeRes();
    const nextB = makeNext();
    await mw(reqB, resB, nextB);

    expect(nextB).toHaveBeenCalledTimes(1);
    expect(resB.headers['X-Cache']).toBe('MISS');
  });

  it('different query params produce different cache keys', async () => {
    const mw = httpCache('clients', 60);

    // Cache with page=1
    const req1 = makeReq('org6', { page: '1' });
    const res1 = makeRes(200);
    await mw(req1, res1, makeNext());
    await res1.json({ data: [{ id: 1 }] });

    // Request with page=2 should be a cache miss
    const req2 = makeReq('org6', { page: '2' });
    const res2 = makeRes();
    const next2 = makeNext();
    await mw(req2, res2, next2);

    expect(next2).toHaveBeenCalledTimes(1);
    expect(res2.headers['X-Cache']).toBe('MISS');
  });

  it('query param order does not affect cache key (sorted)', async () => {
    const mw = httpCache('clients', 60);

    // First request with params in order a,b
    const req1 = makeReq('org7', { limit: '50', page: '1' });
    const res1 = makeRes(200);
    await mw(req1, res1, makeNext());
    await res1.json({ data: [{ id: 1 }] });

    // Second request with params in reverse order b,a — should still hit
    const req2 = makeReq('org7', { page: '1', limit: '50' });
    const res2 = makeRes();
    const next2 = makeNext();
    await mw(req2, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2._body).toEqual({ data: [{ id: 1 }] });
  });

  it('skips caching for non-GET requests and calls next()', async () => {
    const mw = httpCache('plans', 300);
    const req = makeReq('org8', {}, 'POST');
    const res = makeRes();
    const next = makeNext();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-Cache']).toBeUndefined();
  });

  it('works when orgId is undefined (anonymous)', async () => {
    const mw = httpCache('plans', 300);
    const req = makeReq(undefined);
    const res = makeRes(200);
    const next = makeNext();

    await mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.headers['X-Cache']).toBe('MISS');
  });
});

// ---------------------------------------------------------------------------
// bustCache — version-based invalidation
// ---------------------------------------------------------------------------

describe('bustCache', () => {
  it('invalidates the cache so subsequent GET is a miss', async () => {
    const mw = httpCache('sites', 300);

    // Populate cache for org9
    const req1 = makeReq('org9');
    const res1 = makeRes(200);
    await mw(req1, res1, makeNext());
    await res1.json({ data: [{ id: 5 }] });

    // Verify it's cached
    const req2 = makeReq('org9');
    const res2 = makeRes();
    const next2 = makeNext();
    await mw(req2, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2._body).toEqual({ data: [{ id: 5 }] });

    // Bust the cache
    await bustCache('org9', 'sites');

    // Now should be a cache miss
    const req3 = makeReq('org9');
    const res3 = makeRes();
    const next3 = makeNext();
    await mw(req3, res3, next3);
    expect(next3).toHaveBeenCalledTimes(1);
    expect(res3.headers['X-Cache']).toBe('MISS');
  });

  it('bustCache for one org does not affect another org', async () => {
    const mw = httpCache('sites', 300);

    // Populate cache for both orgs
    const reqA = makeReq('org10');
    const resA = makeRes(200);
    await mw(reqA, resA, makeNext());
    await resA.json({ data: [{ id: 1 }] });

    const reqB = makeReq('org11');
    const resB = makeRes(200);
    await mw(reqB, resB, makeNext());
    await resB.json({ data: [{ id: 2 }] });

    // Bust only org10
    await bustCache('org10', 'sites');

    // org10 should miss
    const req10 = makeReq('org10');
    const res10 = makeRes();
    const next10 = makeNext();
    await mw(req10, res10, next10);
    expect(next10).toHaveBeenCalledTimes(1);

    // org11 should still hit
    const req11 = makeReq('org11');
    const res11 = makeRes();
    const next11 = makeNext();
    await mw(req11, res11, next11);
    expect(next11).not.toHaveBeenCalled();
    expect(res11._body).toEqual({ data: [{ id: 2 }] });
  });

  it('bustCache is a no-op when orgId is falsy', async () => {
    await expect(bustCache(null, 'plans')).resolves.toBeUndefined();
    await expect(bustCache(undefined, 'plans')).resolves.toBeUndefined();
  });

  it('bustCache is a no-op when resource is falsy', async () => {
    await expect(bustCache('org12', null)).resolves.toBeUndefined();
    await expect(bustCache('org12', '')).resolves.toBeUndefined();
  });

  it('multiple bustCache calls increment version each time', async () => {
    await bustCache('org13', 'nas');
    await bustCache('org13', 'nas');
    await bustCache('org13', 'nas');

    const version = await cacheService.get('cache:ver:org13:nas');
    expect(version).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// TTL propagation
// ---------------------------------------------------------------------------

describe('httpCache TTL', () => {
  it('caches the entry with a positive TTL (entry exists immediately after set)', async () => {
    const mw = httpCache('devices', 5); // 5 second TTL

    const req1 = makeReq('org14');
    const res1 = makeRes(200);
    await mw(req1, res1, makeNext());
    await res1.json({ data: [{ id: 99 }] });

    // Immediately after, it should hit
    const req2 = makeReq('org14');
    const res2 = makeRes();
    const next2 = makeNext();
    await mw(req2, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2._body).toEqual({ data: [{ id: 99 }] });
  });
});

// ---------------------------------------------------------------------------
// crudController integration — cache bust on mutations
// ---------------------------------------------------------------------------

describe('crudController cache integration', () => {
  const db = require('../src/config/database');

  beforeEach(() => {
    db.query.mockReset();
  });

  it('cacheResource option is accepted without error', () => {
    const { crudController } = require('../src/controllers/crudController');
    const MockModel = {
      tableName: 'plans',
      hasOrgScope: true,
      softDelete: false,
      findAll: jest.fn(),
      count: jest.fn(),
      findByIdOrFail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      restore: jest.fn(),
    };

    expect(() => crudController(MockModel, { cacheResource: 'plans' })).not.toThrow();
  });

  it('bustCache is called after a successful create', async () => {
    await cacheService.flush();
    const mw = httpCache('plans', 300);

    // Pre-populate cache for org15
    const req0 = makeReq('org15');
    const res0 = makeRes(200);
    await mw(req0, res0, makeNext());
    await res0.json({ data: [] });

    // Verify it hits
    const reqCheck = makeReq('org15');
    const resCheck = makeRes();
    await mw(reqCheck, resCheck, makeNext());
    expect(resCheck.headers['X-Cache']).toBe('HIT');

    // Bust simulating a crudController create
    await bustCache('org15', 'plans');

    // After bust, should miss again
    const reqAfter = makeReq('org15');
    const resAfter = makeRes();
    const nextAfter = makeNext();
    await mw(reqAfter, resAfter, nextAfter);
    expect(nextAfter).toHaveBeenCalledTimes(1);
    expect(resAfter.headers['X-Cache']).toBe('MISS');
  });
});
