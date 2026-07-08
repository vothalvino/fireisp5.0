// =============================================================================
// FireISP 5.0 — Session hardening tests
// =============================================================================
// Guards the fixes for the "constantly logged out" defect:
//  1. Session-keepalive endpoints (/auth/me, /auth/refresh, /auth/logout,
//     /auth/switch-organization) have their OWN rate-limit bucket and are
//     skipped by the general API limiter — heavy app usage must never starve
//     the calls that keep a session alive.
//  2. `trust proxy` is configurable (TRUST_PROXY hops) so per-IP rate limits
//     count real clients instead of collapsing into one bucket behind Nginx.
//  3. POST /auth/logout works without ANY credential — after the access token
//     expires, a token-gated logout silently no-oped and the still-valid
//     refresh cookie resurrected the session on the next visit.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const request = require('supertest');
const app = require('../src/app');
const { isSessionPath } = require('../src/middleware/rateLimit');

describe('Session hardening', () => {
  // ---------------------------------------------------------------------------
  // isSessionPath — the carve-out predicate shared by apiLimiter.skip
  // ---------------------------------------------------------------------------
  describe('isSessionPath', () => {
    const req = (originalUrl) => ({ originalUrl });

    it.each([
      '/api/v1/auth/me',
      '/api/auth/me',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/auth/switch-organization',
      '/api/v1/auth/refresh/',
      '/api/v1/auth/me?detail=true',
      '/api/v1/portal/auth/me',       // subscriber portal keepalives too
      '/api/v1/portal/auth/refresh',
      '/api/v1/portal/auth/logout',
    ])('matches session path %s', (url) => {
      expect(isSessionPath(req(url))).toBe(true);
    });

    it.each([
      '/api/v1/auth/login',          // brute-force vector — stays on authLimiter
      '/api/v1/auth/register',
      '/api/v1/auth/password-reset',
      '/api/v1/portal/auth/login',   // portal credential endpoint too
      '/api/v1/clients',
      '/api/v1/auth/me/extra',       // only the exact endpoints are carved out
      '/api/v1/refresh',
    ])('does NOT match %s', (url) => {
      expect(isSessionPath(req(url))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Rate-limit bucket assignment (asserted via draft-7 RateLimit-Policy header)
  // ---------------------------------------------------------------------------
  describe('rate-limit carve-out', () => {
    it('session-keepalive endpoints use the dedicated session bucket, not the general API bucket', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      // sessionLimiter default 240/window; apiLimiter (1000) must be skipped,
      // otherwise its policy header would be the one reported here.
      expect(res.headers['ratelimit-policy']).toContain('240');
    });

    it('subscriber-portal keepalives get the same carve-out', async () => {
      const res = await request(app).get('/api/v1/portal/auth/me');
      expect(res.headers['ratelimit-policy']).toContain('240');
    });

    it('general API endpoints stay on the general bucket', async () => {
      const res = await request(app).get('/api/v1/clients');
      expect(res.headers['ratelimit-policy']).toContain('1000');
    });

    it('login stays on the strict auth limiter (brute-force guard unchanged)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'test@test.com', password: 'password' });
      expect(res.headers['ratelimit-policy']).toContain('20');
    });
  });

  // ---------------------------------------------------------------------------
  // trust proxy
  // ---------------------------------------------------------------------------
  describe('trust proxy', () => {
    it('is disabled by default outside production', () => {
      // NODE_ENV=test here — direct exposure default, no proxy hops trusted.
      expect(app.get('trust proxy')).toBeFalsy();
    });

    it('honors the TRUST_PROXY hop count', () => {
      jest.isolateModules(() => {
        process.env.TRUST_PROXY = '2';
        try {
          const freshApp = require('../src/app');
          expect(freshApp.get('trust proxy')).toBe(2);
        } finally {
          delete process.env.TRUST_PROXY;
        }
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Logout — un-gated but not abusable
  // ---------------------------------------------------------------------------
  describe('POST /auth/logout', () => {
    it('with the refresh cookie: returns 200 and clears auth cookies (post-access-expiry logout must not 401)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', 'fireisp_refresh=some-refresh-token');

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.find((c) => c.startsWith('fireisp_access='))).toBeDefined();
      expect(cookies.find((c) => c.startsWith('fireisp_refresh='))).toBeDefined();
    });

    it('with NO credential at all: returns 200 but emits NO cookie-clearing headers', async () => {
      // A cross-site form POST arrives with no cookies (SameSite=Strict) and
      // no Bearer. Browsers still APPLY Set-Cookie from cross-site responses,
      // so emitting clearing headers here would let an attacker page force-
      // logout a victim. Nothing was presented, so there is nothing to clear.
      const res = await request(app).post('/api/v1/auth/logout');

      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'] || [];
      expect(cookies.find((c) => c.startsWith('fireisp_access='))).toBeUndefined();
      expect(cookies.find((c) => c.startsWith('fireisp_refresh='))).toBeUndefined();
    });

    it('rejects a non-string refreshToken with 422 instead of 500ing in crypto', async () => {
      const res = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: { a: 1 } });

      expect(res.status).toBe(422);
    });
  });
});
