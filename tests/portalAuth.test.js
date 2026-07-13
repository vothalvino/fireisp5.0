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

// The password-reset request route sends real transactional email — mock the
// transport so these tests never attempt a real SMTP connection and can
// assert on the send call directly (mirrors tests/routeIntegration.test.js's
// staff-side password-reset coverage).
jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true, messageId: 'test-message-id' }),
}));

const request = require('supertest');
const db = require('../src/config/database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const emailTransport = require('../src/services/emailTransport');
const portalAuthService = require('../src/services/portalAuthService');
const app = require('../src/app');

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
    db.query.mockResolvedValueOnce([[{
      id: 10, client_id: 1, organization_id: 1, name: 'Alice',
      email: 'alice@example.com', status: 'active',
    }]]);  // SELECT valid token

    // Rotation (revoke + insert) runs in a transaction on a dedicated connection.
    const conn = {
      execute: jest.fn()
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // atomic revoke claim
        .mockResolvedValueOnce([{ insertId: 11 }]),      // insert new
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    const result = await portalAuthService.refreshToken('validtoken');

    expect(result.accessToken).toBe('mock.access.token');
    expect(result.refreshToken).toBeTruthy();
    // The revoke is the atomic claim: guarded on revoked_at IS NULL.
    expect(conn.execute.mock.calls[0][0]).toContain('revoked_at IS NULL');
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  test('loses the concurrent-redeem race cleanly: revoke claims 0 rows → 401, no second pair minted, txn rolled back', async () => {
    db.query.mockResolvedValueOnce([[{
      id: 10, client_id: 1, organization_id: 1, name: 'Alice',
      email: 'alice@example.com', status: 'active',
    }]]);  // stale SELECT — row still visible to this request

    const conn = {
      execute: jest.fn().mockResolvedValueOnce([{ affectedRows: 0 }]),  // other request won the claim
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);

    await expect(portalAuthService.refreshToken('validtoken'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(conn.execute).toHaveBeenCalledTimes(1);  // no INSERT after a lost claim
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
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
// POST /portal/auth/password-reset/request
// ---------------------------------------------------------------------------
// Anti-enumeration: unknown email, portal-never-enabled, and inactive-status
// must all fall through to the IDENTICAL generic response with no token
// generated and no email sent (see design decision #2 in the spec — forgot-
// password must never become a self-service enablement path for a portal
// account the ISP has not turned on).
// ---------------------------------------------------------------------------

describe('POST /portal/auth/password-reset/request', () => {
  beforeEach(() => jest.clearAllMocks());

  test('known, portal-enabled, active client — 200 generic message, updates token columns, emails a /portal/reset-password link', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com',
        status: 'active', portal_password_hash: '$2a$12$x',
      }]]) // SELECT client
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE token columns

    const res = await request(app)
      .post('/api/v1/portal/auth/password-reset/request')
      .send({ email: 'alice@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('If that email exists');

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE clients SET portal_reset_token_hash'),
      expect.any(Array),
    );

    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'alice@example.com', subject: 'Password Reset Request' }),
    );
    const emailCall = emailTransport.sendEmail.mock.calls[0][0];
    expect(emailCall.html).toContain('/portal/reset-password?token=');
  });

  test('unknown email — same generic message, no UPDATE, no email (anti-enumeration)', async () => {
    db.query.mockResolvedValueOnce([[]]); // SELECT client — no match

    const res = await request(app)
      .post('/api/v1/portal/auth/password-reset/request')
      .send({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('If that email exists');
    expect(db.query).toHaveBeenCalledTimes(1); // SELECT only, no UPDATE
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('known email, portal access never enabled (portal_password_hash NULL) — same generic message, no UPDATE, no email', async () => {
    db.query.mockResolvedValueOnce([[{
      id: 2, organization_id: 1, name: 'Bob', email: 'bob@example.com',
      status: 'active', portal_password_hash: null,
    }]]);

    const res = await request(app)
      .post('/api/v1/portal/auth/password-reset/request')
      .send({ email: 'bob@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('If that email exists');
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('known email, inactive status — same generic message, no UPDATE, no email', async () => {
    db.query.mockResolvedValueOnce([[{
      id: 3, organization_id: 1, name: 'Carla', email: 'carla@example.com',
      status: 'inactive', portal_password_hash: '$2a$12$x',
    }]]);

    const res = await request(app)
      .post('/api/v1/portal/auth/password-reset/request')
      .send({ email: 'carla@example.com' });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('If that email exists');
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /portal/auth/password-reset
// ---------------------------------------------------------------------------

describe('POST /portal/auth/password-reset', () => {
  beforeEach(() => jest.clearAllMocks());

  test('valid unexpired token — 200, hashes new password, clears reset + lockout columns, revokes refresh tokens', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, organization_id: 1, name: 'Alice', email: 'alice@example.com',
        status: 'active', portal_reset_token_hash: 'x', portal_reset_token_expires: '2099-01-01 00:00:00',
      }]]) // SELECT by token hash
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE clients (password + clear reset/lockout)
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE portal_refresh_tokens revoke

    const res = await request(app)
      .post('/api/v1/portal/auth/password-reset')
      .send({ token: 'sometoken', password: 'newpassword123' });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password reset successfully');
    expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 12);

    const updateClientsCall = db.query.mock.calls[1];
    expect(updateClientsCall[0]).toContain('portal_password_hash');
    expect(updateClientsCall[0]).toContain('portal_reset_token_hash = NULL');
    expect(updateClientsCall[0]).toContain('portal_login_attempts = 0');
    expect(updateClientsCall[0]).toContain('portal_locked_until = NULL');

    const revokeCall = db.query.mock.calls[2];
    expect(revokeCall[0]).toContain('portal_refresh_tokens');
    expect(revokeCall[0]).toContain('revoked_at = NOW()');
    expect(revokeCall[1]).toEqual([1]);
  });

  test('expired or unknown token — 401, no mutation', async () => {
    db.query.mockResolvedValueOnce([[]]); // no matching, unexpired token

    const res = await request(app)
      .post('/api/v1/portal/auth/password-reset')
      .send({ token: 'badtoken', password: 'newpassword123' });

    expect(res.status).toBe(401);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('password shorter than 8 chars — 422 before any DB hit', async () => {
    const res = await request(app)
      .post('/api/v1/portal/auth/password-reset')
      .send({ token: 'sometoken', password: 'short' });

    expect(res.status).toBe(422);
    expect(db.query).not.toHaveBeenCalled();
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
});
