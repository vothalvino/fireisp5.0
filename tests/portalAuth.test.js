// =============================================================================
// FireISP 5.0 — Client Self-Service Portal Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashedpw'),
  compare: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock.access.token'),
  verify: jest.fn(),
}));

const db = require('../src/config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const portalAuthService = require('../src/services/portalAuthService');

// ---------------------------------------------------------------------------
// portalAuthService.login
// ---------------------------------------------------------------------------

describe('portalAuthService.login()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws ValidationError when email is missing', async () => {
    await expect(portalAuthService.login({ email: '', password: 'pw' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('throws UnauthorizedError when client not found', async () => {
    db.query.mockResolvedValueOnce([[]]); // SELECT client
    await expect(portalAuthService.login({ email: 'x@example.com', password: 'pw' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('throws UnauthorizedError when portal access not enabled', async () => {
    db.query.mockResolvedValueOnce([[{
      id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com',
      status: 'active', portal_password_hash: null,
      portal_login_attempts: 0, portal_locked_until: null,
    }]]);
    await expect(portalAuthService.login({ email: 'alice@example.com', password: 'pw' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('throws UnauthorizedError when account is locked', async () => {
    const future = new Date(Date.now() + 60_000);
    db.query.mockResolvedValueOnce([[{
      id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com',
      status: 'active', portal_password_hash: '$2a$12$x',
      portal_login_attempts: 5, portal_locked_until: future.toISOString(),
    }]]);
    await expect(portalAuthService.login({ email: 'alice@example.com', password: 'wrong' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('increments attempt counter on wrong password and throws', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com',
        status: 'active', portal_password_hash: '$2a$12$x',
        portal_login_attempts: 0, portal_locked_until: null,
      }]])
      .mockResolvedValueOnce([{}]); // UPDATE attempts
    bcrypt.compare.mockResolvedValue(false);

    await expect(portalAuthService.login({ email: 'alice@example.com', password: 'wrong' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE clients SET portal_login_attempts'),
      expect.any(Array),
    );
  });

  test('locks account after MAX_ATTEMPTS failures', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com',
        status: 'active', portal_password_hash: '$2a$12$x',
        portal_login_attempts: 4, portal_locked_until: null,
      }]])
      .mockResolvedValueOnce([{}]); // UPDATE with locked_until
    bcrypt.compare.mockResolvedValue(false);

    await expect(portalAuthService.login({ email: 'alice@example.com', password: 'wrong' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const updateCall = db.query.mock.calls[1];
    expect(updateCall[0]).toContain('portal_locked_until');
  });

  test('returns tokens on successful login', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com',
        status: 'active', portal_password_hash: '$2a$12$x',
        portal_login_attempts: 0, portal_locked_until: null,
      }]])
      .mockResolvedValueOnce([{}])  // reset attempts
      .mockResolvedValueOnce([{ insertId: 10 }]); // INSERT refresh token

    bcrypt.compare.mockResolvedValue(true);

    const result = await portalAuthService.login({ email: 'alice@example.com', password: 'correct' });

    expect(result.accessToken).toBe('mock.access.token');
    expect(result.refreshToken).toBeTruthy();
    expect(result.client.email).toBe('alice@example.com');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'portal', sub: 1 }),
      expect.any(String),
      expect.any(Object),
    );
  });

  test('throws when client status is inactive', async () => {
    db.query.mockResolvedValueOnce([[{
      id: 2, organization_id: 1, name: 'Bob', email: 'bob@example.com',
      status: 'inactive', portal_password_hash: '$2a$12$x',
      portal_login_attempts: 0, portal_locked_until: null,
    }]]);
    await expect(portalAuthService.login({ email: 'bob@example.com', password: 'pw' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});

// ---------------------------------------------------------------------------
// portalAuthService.refreshToken
// ---------------------------------------------------------------------------

describe('portalAuthService.refreshToken()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws when token not provided', async () => {
    await expect(portalAuthService.refreshToken(undefined))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('throws when token not found in DB', async () => {
    db.query.mockResolvedValueOnce([[]]); // no matching token
    await expect(portalAuthService.refreshToken('sometoken'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('rotates refresh token and returns new access token', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 10, client_id: 1, organization_id: 1, name: 'Alice',
        email: 'alice@example.com', status: 'active',
      }]])  // SELECT valid token
      .mockResolvedValueOnce([{}])  // revoke old
      .mockResolvedValueOnce([{ insertId: 11 }]);  // insert new

    const result = await portalAuthService.refreshToken('validtoken');

    expect(result.accessToken).toBe('mock.access.token');
    expect(result.refreshToken).toBeTruthy();
    // Ensure old token was revoked
    expect(db.query.mock.calls[1][0]).toContain('revoked_at');
  });
});

// ---------------------------------------------------------------------------
// portalAuthService.logout
// ---------------------------------------------------------------------------

describe('portalAuthService.logout()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('does nothing when no token provided', async () => {
    await expect(portalAuthService.logout(undefined)).resolves.toBeUndefined();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('revokes the refresh token', async () => {
    db.query.mockResolvedValueOnce([{}]);
    await portalAuthService.logout('sometoken');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('revoked_at'),
      expect.any(Array),
    );
  });
});

// ---------------------------------------------------------------------------
// portal routes — httpOnly cookie auth
// ---------------------------------------------------------------------------

describe('portal auth routes — httpOnly cookies', () => {
  const request = require('supertest');
  const express = require('express');
  const cookieParser = require('cookie-parser');
  const portalRoutes = require('../src/routes/portal');

  function buildApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/portal', portalRoutes);
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 500).json({ error: { message: err.message } });
    });
    return app;
  }

  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  test('login sets portal access and refresh cookies', async () => {
    jest.spyOn(portalAuthService, 'login').mockResolvedValueOnce({
      accessToken: 'portal-access-token',
      refreshToken: 'portal-refresh-token',
      expiresIn: 900,
      client: { id: 1, name: 'Alice', email: 'alice@example.com', organization_id: 1 },
    });

    const res = await request(app)
      .post('/api/v1/portal/auth/login')
      .send({ email: 'alice@example.com', password: 'correct-password' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies.find(c => c.startsWith('fireisp_portal_access='))).toMatch(/HttpOnly/i);
    expect(cookies.find(c => c.startsWith('fireisp_portal_access='))).toMatch(/SameSite=Strict/i);
    expect(cookies.find(c => c.startsWith('fireisp_portal_refresh='))).toMatch(/Path=\/api\/v1\/portal\/auth\/refresh/);
  });

  test('refresh accepts portal refresh token from cookie and rotates cookies', async () => {
    jest.spyOn(portalAuthService, 'refreshToken').mockResolvedValueOnce({
      accessToken: 'new-portal-access',
      refreshToken: 'new-portal-refresh',
      expiresIn: 900,
    });

    const res = await request(app)
      .post('/api/v1/portal/auth/refresh')
      .set('Cookie', 'fireisp_portal_refresh=old-cookie-refresh')
      .send({});

    expect(res.status).toBe(200);
    expect(portalAuthService.refreshToken).toHaveBeenCalledWith('old-cookie-refresh');
    const cookies = res.headers['set-cookie'];
    expect(cookies.find(c => c.startsWith('fireisp_portal_access='))).toContain('new-portal-access');
    expect(cookies.find(c => c.startsWith('fireisp_portal_refresh='))).toContain('new-portal-refresh');
  });

  test('refresh still accepts body refresh token for API clients', async () => {
    jest.spyOn(portalAuthService, 'refreshToken').mockResolvedValueOnce({
      accessToken: 'new-portal-access',
      refreshToken: 'new-portal-refresh',
      expiresIn: 900,
    });

    const res = await request(app)
      .post('/api/v1/portal/auth/refresh')
      .send({ refreshToken: 'body-refresh' });

    expect(res.status).toBe(200);
    expect(portalAuthService.refreshToken).toHaveBeenCalledWith('body-refresh');
  });

  test('logout revokes cookie refresh token and clears cookies', async () => {
    jest.spyOn(portalAuthService, 'logout').mockResolvedValueOnce();

    const res = await request(app)
      .post('/api/v1/portal/auth/logout')
      .set('Cookie', 'fireisp_portal_refresh=revoke-cookie')
      .send({});

    expect(res.status).toBe(200);
    expect(portalAuthService.logout).toHaveBeenCalledWith('revoke-cookie');
    const cookies = res.headers['set-cookie'];
    expect(cookies.find(c => c.startsWith('fireisp_portal_access='))).toMatch(/Expires=/i);
    expect(cookies.find(c => c.startsWith('fireisp_portal_refresh='))).toMatch(/Expires=/i);
  });
});

// ---------------------------------------------------------------------------
// portalAuthService.setPassword
// ---------------------------------------------------------------------------

describe('portalAuthService.setPassword()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws ValidationError for short password', async () => {
    await expect(portalAuthService.setPassword(1, 'short'))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('hashes and stores the new password', async () => {
    db.query.mockResolvedValueOnce([{}]);
    await portalAuthService.setPassword(1, 'newpassword123');
    expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 12);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('portal_password_hash'),
      expect.arrayContaining(['$2a$12$hashedpw', 1]),
    );
  });
});

// ---------------------------------------------------------------------------
// portalAuth middleware
// ---------------------------------------------------------------------------

describe('portalAuth middleware', () => {
  beforeEach(() => jest.clearAllMocks());

  const { portalAuthenticate } = require('../src/middleware/portalAuth');

  test('rejects missing Authorization header', done => {
    const req = { headers: {} };
    const next = jest.fn(err => {
      expect(err.code).toBe('UNAUTHORIZED');
      done();
    });
    portalAuthenticate(req, {}, next);
  });

  test('rejects non-portal token type', done => {
    jwt.verify.mockReturnValue({ sub: 1, orgId: 1, type: 'staff' });
    const req = { headers: { authorization: 'Bearer staff.token' } };
    const next = jest.fn(err => {
      expect(err.code).toBe('UNAUTHORIZED');
      done();
    });
    portalAuthenticate(req, {}, next);
  });

  test('rejects when client not found in DB', done => {
    jwt.verify.mockReturnValue({ sub: 999, orgId: 1, type: 'portal' });
    db.query.mockResolvedValueOnce([[]]); // no client
    const req = { headers: { authorization: 'Bearer portal.token' } };
    const next = jest.fn(err => {
      expect(err.code).toBe('UNAUTHORIZED');
      done();
    });
    portalAuthenticate(req, {}, next);
  });

  test('sets req.client on valid token', done => {
    jwt.verify.mockReturnValue({ sub: 1, orgId: 1, type: 'portal' });
    db.query.mockResolvedValueOnce([[{
      id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com', status: 'active',
    }]]);
    const req = { headers: { authorization: 'Bearer portal.valid' } };
    const next = jest.fn(() => {
      expect(req.client).toMatchObject({ id: 1, name: 'Alice' });
      done();
    });
    portalAuthenticate(req, {}, next);
  });

  test('accepts portal access token from httpOnly cookie', done => {
    jwt.verify.mockReturnValue({ sub: 1, orgId: 1, type: 'portal' });
    db.query.mockResolvedValueOnce([[{
      id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com', status: 'active',
    }]]);
    const req = { headers: {}, cookies: { fireisp_portal_access: 'portal.cookie.token' } };
    const next = jest.fn(() => {
      expect(req.client).toMatchObject({ id: 1, name: 'Alice' });
      expect(jwt.verify).toHaveBeenCalledWith('portal.cookie.token', expect.any(String));
      done();
    });
    portalAuthenticate(req, {}, next);
  });
});
