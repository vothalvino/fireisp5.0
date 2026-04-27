// =============================================================================
// FireISP 5.0 — P3.4 httpOnly cookie auth tests
// =============================================================================
// Verifies that:
//  1. POST /api/v1/auth/login sets httpOnly SameSite=Strict cookies
//  2. POST /api/v1/auth/refresh reads from cookie + sets new cookies
//  3. POST /api/v1/auth/logout clears the cookies
//  4. POST /api/v1/auth/refresh still works with body-only refresh token
//     (backward-compat for API clients)
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
  authenticate: (_req, _res, next) => next(),
}));

jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
  getOrganizations: jest.fn(),
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

    test('sets fireisp_refresh httpOnly cookie scoped to /api/v1/auth/refresh', async () => {
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
      expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth\/refresh/);
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
      expect(authService.refreshToken).toHaveBeenCalledWith('cookie-refresh-token');

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
      expect(authService.refreshToken).toHaveBeenCalledWith('body-refresh-token');
    });

    test('cookie takes precedence over body when both are present', async () => {
      authService.refreshToken.mockResolvedValueOnce(refreshResult);

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .set('Cookie', 'fireisp_refresh=cookie-wins')
        .send({ refreshToken: 'body-loses' });

      expect(authService.refreshToken).toHaveBeenCalledWith('cookie-wins');
      expect(res.status).toBe(200);
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
});
