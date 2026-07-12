// =============================================================================
// FireISP 5.0 — P3.4 httpOnly cookie auth tests
// =============================================================================
// Verifies that:
//  1. POST /api/v1/auth/login sets httpOnly SameSite=Strict cookies
//  2. POST /api/v1/auth/refresh reads from cookie + sets new cookies
//  3. POST /api/v1/auth/logout clears the cookies
//  4. POST /api/v1/auth/refresh still works with body-only refresh token
//     (backward-compat for API clients)
//  5. POST /api/v1/auth/switch-organization receives the refresh token via the
//     httpOnly cookie (Path must cover this route) or the request body
// =============================================================================

jest.mock('../src/services/authService', () => ({
  login: jest.fn(),
  logout: jest.fn(),
  refreshToken: jest.fn(),
  switchOrganization: jest.fn(),
  register: jest.fn(),
  requestPasswordReset: jest.fn(),
  resetPassword: jest.fn(),
  changePassword: jest.fn(),
  verifyEmail: jest.fn(),
  generateEmailVerificationToken: jest.fn(),
  REFRESH_SECONDS: 604800,
  ACCESS_SECONDS: 900,
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    // switch-organization reads req.user.id; /me reads req.user.organizationId (the
    // ACTIVE org from the JWT). Harmless for the other routes.
    req.user = { id: 1, email: 'admin@example.com', role: 'admin', organizationId: 1 };
    next();
  },
}));

jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
  getOrganizations: jest.fn(),
}));

jest.mock('../src/models/Organization', () => ({
  getCurrency: jest.fn().mockResolvedValue('MXN'),
  getLocale: jest.fn().mockResolvedValue('global'),
}));

jest.mock('../src/config', () => ({
  env: 'test',
  jwt: { secret: 'test-secret' },
}));

const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const authRoutes = require('../src/routes/auth');
const authService = require('../src/services/authService');
const User = require('../src/models/User');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v1/auth', authRoutes);
  // Simple error handler
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: { message: err.message } });
  });
  return app;
}

describe('P3.4 — httpOnly cookie auth', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  // =========================================================================
  // POST /auth/login — sets cookies
  // =========================================================================
  describe('POST /api/v1/auth/login', () => {
    const loginPayload = { email: 'admin@example.com', password: 'secret1234' };
    const loginResult = {
      accessToken: 'access-jwt',
      refreshToken: 'opaque-refresh-token',
      expiresIn: 900,
      user: { id: 1, email: 'admin@example.com', role: 'admin' },
    };

    test('sets fireisp_access httpOnly cookie', async () => {
      authService.login.mockResolvedValueOnce(loginResult);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(loginPayload);

      expect(res.status).toBe(200);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const accessCookie = cookies.find(c => c.startsWith('fireisp_access='));
      expect(accessCookie).toBeDefined();
      expect(accessCookie).toContain('access-jwt');
      expect(accessCookie).toMatch(/HttpOnly/i);
      expect(accessCookie).toMatch(/SameSite=Strict/i);
      expect(accessCookie).toMatch(/Path=\/api/);
    });

    test('sets fireisp_refresh httpOnly cookie scoped to /api/v1/auth', async () => {
      authService.login.mockResolvedValueOnce(loginResult);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(loginPayload);

      const cookies = res.headers['set-cookie'];
      const refreshCookie = cookies.find(c => c.startsWith('fireisp_refresh='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain('opaque-refresh-token');
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);
      // Scoped to /api/v1/auth (exactly) — NOT the narrower /api/v1/auth/refresh,
      // otherwise the browser would never attach it to /switch-organization.
      expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth(?:;|$)/);
      expect(refreshCookie).not.toMatch(/Path=\/api\/v1\/auth\/refresh/);
    });

    test('still returns tokens in JSON body for API-client backward compat', async () => {
      authService.login.mockResolvedValueOnce(loginResult);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(loginPayload);

      expect(res.body.data.accessToken).toBe('access-jwt');
      expect(res.body.data.refreshToken).toBe('opaque-refresh-token');
    });
  });

  // =========================================================================
  // POST /auth/refresh — reads cookie, sets new cookies
  // =========================================================================
  describe('POST /api/v1/auth/refresh', () => {
    const refreshResult = {
      accessToken: 'new-access-jwt',
      refreshToken: 'new-refresh-token',
      expiresIn: 900,
    };

    test('accepts refresh token from httpOnly cookie', async () => {
      authService.refreshToken.mockResolvedValueOnce(refreshResult);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'fireisp_refresh=cookie-refresh-token')
        .send({});

      expect(res.status).toBe(200);
      // 2nd arg is the active-org cookie (absent here → undefined).
      expect(authService.refreshToken).toHaveBeenCalledWith('cookie-refresh-token', undefined);

      const cookies = res.headers['set-cookie'];
      expect(cookies.find(c => c.startsWith('fireisp_access='))).toBeDefined();
      expect(cookies.find(c => c.startsWith('fireisp_refresh='))).toBeDefined();
    });

    test('still accepts refresh token from request body (backward compat)', async () => {
      authService.refreshToken.mockResolvedValueOnce(refreshResult);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'body-refresh-token' });

      expect(res.status).toBe(200);
      expect(authService.refreshToken).toHaveBeenCalledWith('body-refresh-token', undefined);
    });

    test('cookie takes precedence over body when both are present', async () => {
      authService.refreshToken.mockResolvedValueOnce(refreshResult);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'fireisp_refresh=cookie-wins')
        .send({ refreshToken: 'body-loses' });

      expect(authService.refreshToken).toHaveBeenCalledWith('cookie-wins', undefined);
      expect(res.status).toBe(200);
    });

    test('forwards the active-org cookie and re-persists it on refresh', async () => {
      authService.refreshToken.mockResolvedValueOnce({ ...refreshResult, activeOrgId: 7 });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'fireisp_refresh=old-token; fireisp_active_org=7')
        .send({});

      expect(res.status).toBe(200);
      // The active org from the cookie is forwarded for server-side re-validation...
      expect(authService.refreshToken).toHaveBeenCalledWith('old-token', '7');
      // ...and re-persisted (scoped to /refresh, httpOnly) so it survives reloads.
      const activeOrgCookie = res.headers['set-cookie'].find(c => c.startsWith('fireisp_active_org='));
      expect(activeOrgCookie).toBeDefined();
      expect(activeOrgCookie).toContain('fireisp_active_org=7');
      expect(activeOrgCookie).toMatch(/Path=\/api\/v1\/auth\/refresh/);
      expect(activeOrgCookie).toMatch(/HttpOnly/i);
    });

    test('returns 401 when neither cookie nor body refresh token provided', async () => {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(res.status).toBe(401);
      expect(authService.refreshToken).not.toHaveBeenCalled();
    });

    test('rotates both cookies on successful refresh', async () => {
      authService.refreshToken.mockResolvedValueOnce(refreshResult);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'fireisp_refresh=old-token')
        .send({});

      const cookies = res.headers['set-cookie'];
      const accessCookie = cookies.find(c => c.startsWith('fireisp_access='));
      const refreshCookie = cookies.find(c => c.startsWith('fireisp_refresh='));

      expect(accessCookie).toContain('new-access-jwt');
      expect(refreshCookie).toContain('new-refresh-token');
    });
  });

  // =========================================================================
  // POST /auth/logout — clears cookies
  // =========================================================================
  describe('POST /api/v1/auth/logout', () => {
    test('clears fireisp_access and fireisp_refresh cookies', async () => {
      authService.logout.mockResolvedValueOnce();

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', 'fireisp_refresh=some-refresh-token');

      expect(res.status).toBe(200);

      const cookies = res.headers['set-cookie'];
      // Cleared cookies are set with empty value and a past / zero maxAge
      const accessCleared = cookies.find(c => c.startsWith('fireisp_access='));
      const refreshCleared = cookies.find(c => c.startsWith('fireisp_refresh='));
      expect(accessCleared).toBeDefined();
      expect(refreshCleared).toBeDefined();
      // Express clearCookie sets Expires in the past
      expect(accessCleared).toMatch(/Expires=/i);
      expect(refreshCleared).toMatch(/Expires=/i);
    });

    test('reads refresh token from cookie to revoke session', async () => {
      authService.logout.mockResolvedValueOnce();

      await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', 'fireisp_refresh=revoke-this-token');

      expect(authService.logout).toHaveBeenCalledWith('revoke-this-token');
    });

    test('still accepts refresh token from body for API-client backward compat', async () => {
      authService.logout.mockResolvedValueOnce();

      await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken: 'body-token' });

      expect(authService.logout).toHaveBeenCalledWith('body-token');
    });
  });

  // =========================================================================
  // POST /auth/switch-organization — requires the refresh token (cookie/body)
  // =========================================================================
  describe('POST /api/v1/auth/switch-organization', () => {
    const switchResult = {
      accessToken: 'switched-access-jwt',
      refreshToken: 'switched-refresh-token',
      expiresIn: 900,
      organization: { id: 7, name: 'Acme', membership_role: 'admin' },
    };

    test('forwards the httpOnly refresh cookie to the service', async () => {
      authService.switchOrganization.mockResolvedValueOnce(switchResult);

      const res = await request(app)
        .post('/api/v1/auth/switch-organization')
        .set('Cookie', 'fireisp_refresh=cookie-refresh-token')
        .send({ organizationId: 7 });

      expect(res.status).toBe(200);
      // (userId, organizationId, refreshToken) — the cookie must reach the service.
      expect(authService.switchOrganization).toHaveBeenCalledWith(1, 7, 'cookie-refresh-token');
      expect(res.body.data.organization.id).toBe(7);
    });

    test('falls back to the body refresh token for API clients', async () => {
      authService.switchOrganization.mockResolvedValueOnce(switchResult);

      const res = await request(app)
        .post('/api/v1/auth/switch-organization')
        .send({ organizationId: 7, refreshToken: 'body-refresh-token' });

      expect(res.status).toBe(200);
      expect(authService.switchOrganization).toHaveBeenCalledWith(1, 7, 'body-refresh-token');
    });

    test('cookie takes precedence over body when both are present', async () => {
      authService.switchOrganization.mockResolvedValueOnce(switchResult);

      await request(app)
        .post('/api/v1/auth/switch-organization')
        .set('Cookie', 'fireisp_refresh=cookie-wins')
        .send({ organizationId: 7, refreshToken: 'body-loses' });

      expect(authService.switchOrganization).toHaveBeenCalledWith(1, 7, 'cookie-wins');
    });

    test('rotates both auth cookies on a successful switch', async () => {
      authService.switchOrganization.mockResolvedValueOnce(switchResult);

      const res = await request(app)
        .post('/api/v1/auth/switch-organization')
        .set('Cookie', 'fireisp_refresh=old-token')
        .send({ organizationId: 7 });

      const cookies = res.headers['set-cookie'];
      expect(cookies.find(c => c.startsWith('fireisp_access='))).toContain('switched-access-jwt');
      expect(cookies.find(c => c.startsWith('fireisp_refresh='))).toContain('switched-refresh-token');
    });

    test('persists the new active org as an httpOnly cookie scoped to /refresh', async () => {
      authService.switchOrganization.mockResolvedValueOnce(switchResult);

      const res = await request(app)
        .post('/api/v1/auth/switch-organization')
        .set('Cookie', 'fireisp_refresh=old-token')
        .send({ organizationId: 7 });

      // So a later /refresh (page reload) re-mints the token bound to org 7
      // instead of reverting to the user's primary org.
      const activeOrgCookie = res.headers['set-cookie'].find(c => c.startsWith('fireisp_active_org='));
      expect(activeOrgCookie).toContain('fireisp_active_org=7');
      expect(activeOrgCookie).toMatch(/Path=\/api\/v1\/auth\/refresh/);
      expect(activeOrgCookie).toMatch(/HttpOnly/i);
    });

    // Regression guard for the path-mismatch bug: the refresh cookie's Path must
    // cover /switch-organization, or the browser silently omits it and the
    // service throws "Refresh token required to switch organizations".
    test('refresh cookie Path scopes to cover the /switch-organization route', async () => {
      authService.login.mockResolvedValueOnce({
        accessToken: 'a', refreshToken: 'r', expiresIn: 900,
        user: { id: 1, email: 'admin@example.com', role: 'admin' },
      });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'admin@example.com', password: 'secret1234' });

      const refreshCookie = res.headers['set-cookie'].find(c => c.startsWith('fireisp_refresh='));
      const cookiePath = /Path=([^;]+)/.exec(refreshCookie)[1];

      // RFC 6265 path-matching: the request path must equal the cookie Path or
      // sit directly beneath it. Encodes the exact condition the bug violated.
      const switchPath = '/api/v1/auth/switch-organization';
      const covered = switchPath === cookiePath || switchPath.startsWith(`${cookiePath}/`);
      expect(covered).toBe(true);
    });
  });

  // =========================================================================
  // GET /api/v1/auth/me — must report the ACTIVE org, not the stored home org
  // =========================================================================
  describe('GET /api/v1/auth/me', () => {
    test('reports req.user.organizationId (active org), not the stale users.organization_id', async () => {
      // findById returns the user's stored home org (99); the active org from the
      // access token (set by the authenticate mock) is 1. The switcher binds to
      // this value, so it MUST be the active org or the UI snaps back after a switch.
      User.findById.mockResolvedValueOnce({
        id: 1, email: 'admin@example.com', role: 'admin', organization_id: 99,
      });
      User.getOrganizations.mockResolvedValueOnce([{ id: 1, name: 'Home' }, { id: 7, name: 'Acme' }]);

      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(200);
      expect(res.body.data.organization_id).toBe(1);
      expect(res.body.data.organizations).toHaveLength(2);
      // The active org's currency is resolved server-side (works even when the
      // active org isn't in the membership list).
      expect(res.body.data.organization_currency).toBe('MXN');
    });
  });
});
