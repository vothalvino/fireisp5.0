// =============================================================================
// FireISP 5.0 — Rate Limiter Tests
// =============================================================================

const { apiLimiter, authLimiter, publicLimiter, uploadLimiter, exportLimiter } = require('../src/middleware/rateLimit');

describe('Rate Limiters', () => {
  it('exports all five limiters', () => {
    expect(apiLimiter).toBeDefined();
    expect(authLimiter).toBeDefined();
    expect(publicLimiter).toBeDefined();
    expect(uploadLimiter).toBeDefined();
    expect(exportLimiter).toBeDefined();
  });

  it('each limiter is a function (Express middleware)', () => {
    expect(typeof apiLimiter).toBe('function');
    expect(typeof authLimiter).toBe('function');
    expect(typeof publicLimiter).toBe('function');
    expect(typeof uploadLimiter).toBe('function');
    expect(typeof exportLimiter).toBe('function');
  });
});
