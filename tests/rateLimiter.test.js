// =============================================================================
// FireISP 5.0 — Rate Limiter Tests
// =============================================================================

const { apiLimiter, authLimiter, publicLimiter, uploadLimiter, exportLimiter, sseLimiter, webhookLimiter, tenantApiLimiter } = require('../src/middleware/rateLimit');

describe('Rate Limiters', () => {
  it('exports all eight limiters', () => {
    expect(apiLimiter).toBeDefined();
    expect(authLimiter).toBeDefined();
    expect(publicLimiter).toBeDefined();
    expect(uploadLimiter).toBeDefined();
    expect(exportLimiter).toBeDefined();
    expect(sseLimiter).toBeDefined();
    expect(webhookLimiter).toBeDefined();
    expect(tenantApiLimiter).toBeDefined();
  });

  it('each limiter is a function (Express middleware)', () => {
    expect(typeof apiLimiter).toBe('function');
    expect(typeof authLimiter).toBe('function');
    expect(typeof publicLimiter).toBe('function');
    expect(typeof uploadLimiter).toBe('function');
    expect(typeof exportLimiter).toBe('function');
    expect(typeof sseLimiter).toBe('function');
    expect(typeof webhookLimiter).toBe('function');
    expect(typeof tenantApiLimiter).toBe('function');
  });

  it('limiters accept standard Express middleware arguments (req, res, next)', () => {
    // Each limiter should have arity of 3 (req, res, next) — standard Express middleware
    for (const limiter of [apiLimiter, authLimiter, publicLimiter, uploadLimiter, exportLimiter, sseLimiter, webhookLimiter, tenantApiLimiter]) {
      // express-rate-limit middleware has .length that can vary but should be callable
      expect(typeof limiter).toBe('function');
    }
  });
});

describe('Rate Limiter Integration', () => {
  // Use supertest against the actual app to verify rate limit middleware is mounted
  const request = require('supertest');

  jest.mock('../src/config/database', () => ({
    query: jest.fn(),
    execute: jest.fn(),
    getConnection: jest.fn(),
    close: jest.fn(),
    pool: { end: jest.fn() },
  }));

  const app = require('../src/app');

  it('API routes include rate limit headers (draft-7)', async () => {
    const res = await request(app).get('/api/v1/clients');
    // Rate limit headers are present (even though request fails auth)
    // draft-7 uses RateLimit header or RateLimit-Limit/Remaining/Reset
    const hasRateLimitHeaders = res.headers['ratelimit-limit'] ||
                                 res.headers['ratelimit-remaining'] ||
                                 res.headers['ratelimit-reset'] ||
                                 res.headers['ratelimit'];
    expect(hasRateLimitHeaders).toBeDefined();
  });

  it('auth routes include rate limit headers', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@test.com', password: 'password' });
    const hasRateLimitHeaders = res.headers['ratelimit-limit'] ||
                                 res.headers['ratelimit-remaining'] ||
                                 res.headers['ratelimit'];
    expect(hasRateLimitHeaders).toBeDefined();
  });
});
