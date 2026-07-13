// =============================================================================
// FireISP 5.0 — Bulk Email Rate Limiting Tests
// =============================================================================
// Covers the two independent rate-limit layers added to POST /bulk/email:
//   1. bulkEmailLimiter — per-IP request-count budget (express-rate-limit).
//   2. checkBulkEmailDailyBudget — per-organization rolling-24h RECIPIENT
//      count budget, built directly on cacheService.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/cacheService', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  flush: jest.fn(),
}));

const cacheService = require('../src/services/cacheService');
const { bulkEmailLimiter, checkBulkEmailDailyBudget } = require('../src/middleware/rateLimit');

function makeReq(ip = '1.2.3.4') {
  // app.get('trust proxy') stub — express-rate-limit's default keyGenerator
  // validates this against a real Express `req.app`, which a plain object
  // literal doesn't have; without it every call logs a noisy (non-fatal)
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR-adjacent console.error.
  return { ip, headers: {}, socket: { remoteAddress: ip }, app: { get: () => false } };
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

beforeEach(() => {
  jest.resetAllMocks();
});

describe('bulkEmailLimiter middleware', () => {
  it('is an Express middleware function', () => {
    expect(typeof bulkEmailLimiter).toBe('function');
  });

  it('calls next() for a request under the limit', (done) => {
    bulkEmailLimiter(makeReq('9.9.9.1'), makeRes(), (err) => {
      expect(err).toBeUndefined();
      done();
    });
  });

  it('blocks with 429 once the per-IP budget (RATE_LIMIT_BULK_EMAIL) is exhausted', async () => {
    const rateLimit = require('express-rate-limit');
    // Fresh limiter instance with a tiny budget — mirrors bulkEmailLimiter's
    // own construction (makeLimiter) without depending on the real
    // RATE_LIMIT_BULK_EMAIL env default (10), which would make this test slow.
    const limiter = rateLimit({
      windowMs: 60 * 1000,
      max: 1,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Too many bulk email requests, please try again later' } },
    });

    const ip = '9.9.9.2';
    const run = () => new Promise((resolve) => {
      const res = makeRes();
      limiter(makeReq(ip), res, () => resolve({ passed: true, res }));
      setTimeout(() => resolve({ passed: false, res }), 100);
    });

    const r1 = await run();
    expect(r1.passed).toBe(true);

    const r2 = await run();
    const blocked = !r2.passed || r2.res._statusCode === 429;
    expect(blocked).toBe(true);
  });
});

describe('checkBulkEmailDailyBudget()', () => {
  it('allows a request under the limit and stores the incremented count', async () => {
    cacheService.get.mockResolvedValue(null); // no prior usage today

    const result = await checkBulkEmailDailyBudget('org-1', 100, 5000);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4900);
    expect(cacheService.set).toHaveBeenCalledTimes(1);
    const [key, value, ttlSeconds] = cacheService.set.mock.calls[0];
    expect(key).toBe('bulk_email_daily:org-1');
    expect(value.count).toBe(100);
    expect(ttlSeconds).toBeGreaterThan(0);
    expect(ttlSeconds).toBeLessThanOrEqual(24 * 60 * 60);
  });

  it('rejects a request that would exceed the limit, reporting correct remaining', async () => {
    cacheService.get.mockResolvedValue({ count: 4950, resetAt: Date.now() + 60 * 60 * 1000 });

    const result = await checkBulkEmailDailyBudget('org-2', 100, 5000);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(50);
    // A rejected request must NOT write a new count — it never happened.
    expect(cacheService.set).not.toHaveBeenCalled();
  });

  it('does not reset the window on a second call within the same 24h period', async () => {
    const resetAt = Date.now() + 12 * 60 * 60 * 1000; // 12h remaining
    cacheService.get.mockResolvedValue({ count: 200, resetAt });

    const result = await checkBulkEmailDailyBudget('org-3', 50, 5000);

    expect(result.allowed).toBe(true);
    const [, value, ttlSeconds] = cacheService.set.mock.calls[0];
    // resetAt preserved (not pushed forward to a fresh 24h window)
    expect(value.resetAt).toBe(resetAt);
    expect(value.count).toBe(250);
    // ttlSeconds shrinks to match the preserved (shorter) remaining window,
    // not a fresh 24h (86400s).
    expect(ttlSeconds).toBeLessThan(24 * 60 * 60);
    expect(ttlSeconds).toBeGreaterThan(0);
  });

  it('starts a fresh window once the previous one has expired', async () => {
    cacheService.get.mockResolvedValue({ count: 4999, resetAt: Date.now() - 1000 }); // expired

    const result = await checkBulkEmailDailyBudget('org-4', 100, 5000);

    // Expired window's usage must not carry over — a fresh 5000 budget applies.
    expect(result.allowed).toBe(true);
    const [, value] = cacheService.set.mock.calls[0];
    expect(value.count).toBe(100);
  });
});
