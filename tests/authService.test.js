// =============================================================================
// FireISP 5.0 — Auth Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$12$hashedpassword'),
  compare: jest.fn(),
}));

const crypto = require('crypto');
const db = require('../src/config/database');
const bcrypt = require('bcryptjs');
const authService = require('../src/services/authService');

describe('authService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // register
  // =========================================================================
  describe('register', () => {
    test('creates a new user successfully', async () => {
      const newUser = { id: 1, first_name: 'John', last_name: 'Doe', email: 'john@example.com', role: 'support', status: 'active' };

      // findByEmail returns null (no existing user)
      db.query
        .mockResolvedValueOnce([[]])  // findByEmail
        .mockResolvedValueOnce([{ insertId: 1 }])  // User.create INSERT
        .mockResolvedValueOnce([[{ ...newUser, password_hash: '$2a$12$hashedpassword' }]]);  // User.create findById

      const result = await authService.register({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        password: 'securepassword123',
      });

      expect(result.email).toBe('john@example.com');
      expect(result.password_hash).toBeUndefined(); // should not include password hash
      expect(bcrypt.hash).toHaveBeenCalledWith('securepassword123', 12);
    });

    test('throws ConflictError when email already exists', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, email: 'john@example.com' }]]);

      await expect(
        authService.register({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'securepassword123',
        }),
      ).rejects.toThrow('Email already registered');
    });

    test('throws ValidationError when password too short', async () => {
      db.query.mockResolvedValueOnce([[]]); // no existing user

      await expect(
        authService.register({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'short',
        }),
      ).rejects.toThrow('Password must be at least 8 characters');
    });

    test('throws ValidationError when password is missing', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await expect(
        authService.register({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
        }),
      ).rejects.toThrow('Password must be at least 8 characters');
    });

    test('creates organization_users membership when organizationId is provided', async () => {
      const newUser = { id: 5, first_name: 'Jane', last_name: 'Smith', email: 'jane@example.com', role: 'admin', status: 'active' };

      db.query
        .mockResolvedValueOnce([[]])  // findByEmail
        .mockResolvedValueOnce([{ insertId: 5 }])  // INSERT user
        .mockResolvedValueOnce([[{ ...newUser, password_hash: '$2a$12$hashedpassword' }]])  // findById
        .mockResolvedValueOnce([{ insertId: 1 }]);  // INSERT organization_users

      const result = await authService.register({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        password: 'securepassword123',
        organizationId: 42,
        role: 'admin',
      });

      expect(result.id).toBe(5);
      // Verify organization_users INSERT was called
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organization_users'),
        [42, 5, 'admin'],
      );
    });

    test('uses default role "support" when no role provided', async () => {
      const newUser = { id: 6, first_name: 'Bob', last_name: 'Brown', email: 'bob@example.com', role: 'support', status: 'active' };

      db.query
        .mockResolvedValueOnce([[]])   // findByEmail
        .mockResolvedValueOnce([{ insertId: 6 }])  // INSERT
        .mockResolvedValueOnce([[{ ...newUser, password_hash: '$2a$12$hashedpassword' }]]);

      await authService.register({
        firstName: 'Bob', lastName: 'Brown',
        email: 'bob@example.com', password: 'password123',
      });

      // Verify the INSERT was called with 'support' as default role
      const insertCall = db.query.mock.calls[1];
      expect(insertCall[1]).toContain('support');
    });

    test('does not create organization_users when no organizationId', async () => {
      const newUser = { id: 7, first_name: 'No', last_name: 'Org', email: 'no@org.com', role: 'support', status: 'active' };

      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 7 }])
        .mockResolvedValueOnce([[{ ...newUser, password_hash: '$2a$12$hashedpassword' }]]);

      await authService.register({
        firstName: 'No', lastName: 'Org',
        email: 'no@org.com', password: 'password123',
      });

      // Should only be 3 db.query calls (findByEmail, INSERT user, findById)
      expect(db.query).toHaveBeenCalledTimes(3);
    });

    test('uses "readonly" role for org membership when role not provided', async () => {
      const newUser = { id: 8, first_name: 'Def', last_name: 'Role', email: 'def@role.com', role: 'support', status: 'active' };

      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ insertId: 8 }])
        .mockResolvedValueOnce([[{ ...newUser, password_hash: '$2a$12$hashedpassword' }]])
        .mockResolvedValueOnce([{ insertId: 1 }]);  // org_users INSERT

      await authService.register({
        firstName: 'Def', lastName: 'Role',
        email: 'def@role.com', password: 'password123',
        organizationId: 10,
      });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO organization_users'),
        [10, 8, 'readonly'],
      );
    });
  });

  // =========================================================================
  // login
  // =========================================================================
  describe('login', () => {
    test('returns accessToken, refreshToken and user on successful login', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
        failed_login_attempts: 0, locked_until: null,
      };

      db.query
        .mockResolvedValueOnce([[user]])  // findByEmail
        .mockResolvedValueOnce([])  // UPDATE last_login_at
        .mockResolvedValueOnce([[]])  // getOrganizations
        .mockResolvedValueOnce([]);  // INSERT user_sessions

      bcrypt.compare.mockResolvedValueOnce(true);

      const result = await authService.login({
        email: 'john@example.com',
        password: 'correctpassword',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBe(3600); // 60-minute access token
      expect(result.user.email).toBe('john@example.com');
      expect(result.user.password_hash).toBeUndefined();
    });

    test('throws UnauthorizedError for non-existent email', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await expect(
        authService.login({ email: 'unknown@example.com', password: 'password' }),
      ).rejects.toThrow('Invalid email or password');
    });

    test('throws UnauthorizedError for inactive account', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, email: 'john@example.com', status: 'inactive' }]]);

      await expect(
        authService.login({ email: 'john@example.com', password: 'password' }),
      ).rejects.toThrow('Account is inactive');
    });

    test('throws UnauthorizedError for wrong password', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin',
        failed_login_attempts: 0, locked_until: null,
      };
      db.query
        .mockResolvedValueOnce([[user]])  // findByEmail
        .mockResolvedValueOnce([]);  // UPDATE failed_login_attempts
      bcrypt.compare.mockResolvedValueOnce(false);

      await expect(
        authService.login({ email: 'john@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow('Invalid email or password');
    });

    test('increments failed_login_attempts on wrong password', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin',
        failed_login_attempts: 2, locked_until: null,
      };
      db.query
        .mockResolvedValueOnce([[user]])
        .mockResolvedValueOnce([]);
      bcrypt.compare.mockResolvedValueOnce(false);

      await expect(authService.login({ email: 'john@example.com', password: 'wrong' })).rejects.toThrow();

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET failed_login_attempts'),
        [3, 1],
      );
    });

    test('locks account after MAX_LOGIN_ATTEMPTS failed attempts', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin',
        failed_login_attempts: 4, locked_until: null,
      };
      db.query
        .mockResolvedValueOnce([[user]])
        .mockResolvedValueOnce([]);
      bcrypt.compare.mockResolvedValueOnce(false);

      await expect(authService.login({ email: 'john@example.com', password: 'wrong' })).rejects.toThrow();

      // Should set locked_until (5th attempt = lock)
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('locked_until'),
        expect.arrayContaining([5, 15, 1]),
      );
    });

    test('throws when account is locked', async () => {
      const futureDate = new Date(Date.now() + 600000).toISOString(); // 10 min in future
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin',
        failed_login_attempts: 5, locked_until: futureDate,
      };
      db.query.mockResolvedValueOnce([[user]]);

      await expect(
        authService.login({ email: 'john@example.com', password: 'anything' }),
      ).rejects.toThrow('Account temporarily locked');
    });

    test('allows login after lockout expires', async () => {
      const pastDate = new Date(Date.now() - 60000).toISOString(); // 1 min in past
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
        failed_login_attempts: 5, locked_until: pastDate,
      };

      db.query
        .mockResolvedValueOnce([[user]])  // findByEmail
        .mockResolvedValueOnce([])  // Reset failed attempts
        .mockResolvedValueOnce([])  // UPDATE last_login_at
        .mockResolvedValueOnce([[]])  // getOrganizations
        .mockResolvedValueOnce([]);  // INSERT user_sessions

      bcrypt.compare.mockResolvedValueOnce(true);

      const result = await authService.login({ email: 'john@example.com', password: 'correct' });
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    test('resets failed_login_attempts on successful login', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
        failed_login_attempts: 3, locked_until: null,
      };

      db.query
        .mockResolvedValueOnce([[user]])  // findByEmail
        .mockResolvedValueOnce([])  // Reset failed attempts
        .mockResolvedValueOnce([])  // UPDATE last_login_at
        .mockResolvedValueOnce([[]])  // getOrganizations
        .mockResolvedValueOnce([]);  // INSERT user_sessions

      bcrypt.compare.mockResolvedValueOnce(true);

      await authService.login({ email: 'john@example.com', password: 'correct' });

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('failed_login_attempts = 0'),
        [1],
      );
    });

    test('token contains expected claims', async () => {
      const jwt = require('jsonwebtoken');
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
        failed_login_attempts: 0, locked_until: null,
      };

      db.query
        .mockResolvedValueOnce([[user]])  // findByEmail
        .mockResolvedValueOnce([])  // UPDATE last_login_at
        .mockResolvedValueOnce([[{ id: 42 }]])  // getOrganizations
        .mockResolvedValueOnce([]);  // INSERT user_sessions

      bcrypt.compare.mockResolvedValueOnce(true);

      const result = await authService.login({ email: 'john@example.com', password: 'correct' });
      const decoded = jwt.decode(result.accessToken);

      expect(decoded.sub).toBe(1);
      expect(decoded.email).toBe('john@example.com');
      expect(decoded.role).toBe('admin');
      expect(decoded.orgId).toBe(42);
      expect(decoded.exp).toBeDefined();
    });

    test('session is recorded with refresh token hash', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
        failed_login_attempts: 0, locked_until: null,
      };

      db.query
        .mockResolvedValueOnce([[user]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([]);

      bcrypt.compare.mockResolvedValueOnce(true);

      const result = await authService.login({ email: 'john@example.com', password: 'correct' });

      // Verify INSERT user_sessions was called
      const sessionInsert = db.query.mock.calls.find(c => c[0].includes('INSERT INTO user_sessions'));
      expect(sessionInsert).toBeDefined();

      // Verify the token hash matches the refresh token (not the access JWT)
      const expectedHash = crypto.createHash('sha256').update(result.refreshToken).digest('hex');
      expect(sessionInsert[1][1]).toBe(expectedHash);
    });

    test('returns organizations list from login', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
        failed_login_attempts: 0, locked_until: null,
      };
      const orgs = [{ id: 42, name: 'ISP Corp' }, { id: 43, name: 'Second Org' }];

      db.query
        .mockResolvedValueOnce([[user]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([orgs])  // getOrganizations
        .mockResolvedValueOnce([]);

      bcrypt.compare.mockResolvedValueOnce(true);

      const result = await authService.login({ email: 'john@example.com', password: 'correct' });
      expect(result.organizations).toBeDefined();
    });

    test('does not skip reset when failed_login_attempts is 0', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
        failed_login_attempts: 0, locked_until: null,
      };

      db.query
        .mockResolvedValueOnce([[user]])  // findByEmail
        .mockResolvedValueOnce([])  // UPDATE last_login_at
        .mockResolvedValueOnce([[]])  // getOrganizations
        .mockResolvedValueOnce([]);  // INSERT user_sessions

      bcrypt.compare.mockResolvedValueOnce(true);

      await authService.login({ email: 'john@example.com', password: 'correct' });

      // Should NOT have called the reset query since failed_login_attempts is 0
      const resetCall = db.query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('failed_login_attempts = 0'),
      );
      expect(resetCall).toBeUndefined();
    });
  });

  // =========================================================================
  // refreshToken
  // =========================================================================
  describe('refreshToken', () => {
    test('issues a new token pair for valid refresh token', async () => {
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      db.query
        .mockResolvedValueOnce([[{ id: 1, token_hash: refreshHash, user_id: 1, token_family: 'fam-1', expires_at: futureDate }]])  // session exists
        .mockResolvedValueOnce([[{ id: 1, email: 'john@example.com', role: 'admin', status: 'active', organization_id: 42 }]])  // findById
        .mockResolvedValueOnce([[{ id: 42 }]])  // getOrganizations
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE old session
        .mockResolvedValueOnce([{ insertId: 2 }]);  // INSERT new session

      const result = await authService.refreshToken(refreshTokenValue);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(refreshTokenValue); // new refresh token
      expect(result.expiresIn).toBe(3600); // 60-minute access token
    });

    test('preserves a valid requested active org across refresh (admin → non-membership org)', async () => {
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      db.query
        .mockResolvedValueOnce([[{ id: 1, token_hash: refreshHash, user_id: 1, token_family: 'fam-1', expires_at: futureDate }]]) // session
        .mockResolvedValueOnce([[{ id: 1, email: 'a@b.com', role: 'admin', status: 'active', organization_id: 1 }]]) // findById
        .mockResolvedValueOnce([[{ id: 1 }]])               // getOrganizations → primary org 1
        .mockResolvedValueOnce([[{ id: 7, name: 'Acme' }]]) // resolveActiveOrg: org 7 exists
        .mockResolvedValueOnce([[]])                        // resolveActiveOrg: not a member (admin allowed anyway)
        .mockResolvedValueOnce([{ affectedRows: 1 }])       // DELETE old
        .mockResolvedValueOnce([{ insertId: 2 }]);          // INSERT new

      const result = await authService.refreshToken(refreshTokenValue, '7');

      expect(result.activeOrgId).toBe(7);
    });

    test('falls back to the primary org when the requested active org is not permitted', async () => {
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      db.query
        .mockResolvedValueOnce([[{ id: 1, token_hash: refreshHash, user_id: 1, token_family: 'fam-1', expires_at: futureDate }]]) // session
        .mockResolvedValueOnce([[{ id: 1, email: 'a@b.com', role: 'support', status: 'active', organization_id: 1 }]]) // findById (non-admin)
        .mockResolvedValueOnce([[{ id: 1 }]])               // getOrganizations → primary org 1
        .mockResolvedValueOnce([[{ id: 7, name: 'Acme' }]]) // resolveActiveOrg: org 7 exists
        .mockResolvedValueOnce([[]])                        // resolveActiveOrg: not a member → null (non-admin)
        .mockResolvedValueOnce([{ affectedRows: 1 }])       // DELETE old
        .mockResolvedValueOnce([{ insertId: 2 }]);          // INSERT new

      // Not an admin and not a member of org 7 → the switch is rejected on refresh.
      const result = await authService.refreshToken(refreshTokenValue, '7');

      expect(result.activeOrgId).toBe(1);
    });

    test('throws for invalid refresh token (no session found)', async () => {
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');

      db.query.mockResolvedValueOnce([[]]);  // session lookup returns empty

      await expect(
        authService.refreshToken(refreshTokenValue),
      ).rejects.toThrow('Invalid or expired refresh token');
    });

    test('throws when refresh token is expired', async () => {
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
      const pastDate = new Date(Date.now() - 60000).toISOString();

      db.query
        .mockResolvedValueOnce([[{ id: 1, token_hash: refreshHash, user_id: 1, token_family: 'fam-1', expires_at: pastDate }]])
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // DELETE expired session

      await expect(
        authService.refreshToken(refreshTokenValue),
      ).rejects.toThrow('Refresh token expired');
    });

    test('throws when user is inactive', async () => {
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      db.query
        .mockResolvedValueOnce([[{ id: 1, token_hash: refreshHash, user_id: 1, token_family: 'fam-1', expires_at: futureDate }]])
        .mockResolvedValueOnce([[{ id: 1, email: 'john@example.com', status: 'inactive' }]]);  // findById — inactive

      await expect(
        authService.refreshToken(refreshTokenValue),
      ).rejects.toThrow('User not found or inactive');
    });

    test('rotates session: deletes old, creates new with same family', async () => {
      const refreshTokenValue = crypto.randomBytes(32).toString('hex');
      const refreshHash = crypto.createHash('sha256').update(refreshTokenValue).digest('hex');
      const futureDate = new Date(Date.now() + 86400000).toISOString();

      db.query
        .mockResolvedValueOnce([[{ id: 10, token_hash: refreshHash, user_id: 1, token_family: 'fam-abc', expires_at: futureDate }]])
        .mockResolvedValueOnce([[{ id: 1, email: 'john@example.com', role: 'admin', status: 'active', organization_id: 42 }]])
        .mockResolvedValueOnce([[{ id: 42 }]])  // getOrganizations
        .mockResolvedValueOnce([{ affectedRows: 1 }])   // DELETE old
        .mockResolvedValueOnce([{ insertId: 11 }]);      // INSERT new

      const result = await authService.refreshToken(refreshTokenValue);

      // Verify DELETE was called with old session id
      const deleteCall = db.query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('DELETE FROM user_sessions WHERE id'),
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[1]).toContain(10);

      // Verify INSERT carries the same token_family
      const insertCall = db.query.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO user_sessions'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall[1]).toContain('fam-abc');

      // New refresh token hash should be stored
      const newHash = crypto.createHash('sha256').update(result.refreshToken).digest('hex');
      expect(insertCall[1]).toContain(newHash);
    });
  });

  // =========================================================================
  // logout
  // =========================================================================
  describe('logout', () => {
    test('deletes session by refresh token hash', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await authService.logout('some-refresh-token');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM user_sessions'),
        expect.any(Array),
      );
    });

    test('completes without error even if no session found', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      await expect(authService.logout('expired-token')).resolves.not.toThrow();
    });

    test('uses SHA-256 hash of refresh token for lookup', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const token = 'test-refresh-token-123';
      const expectedHash = crypto.createHash('sha256').update(token).digest('hex');

      await authService.logout(token);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM user_sessions'),
        [expectedHash],
      );
    });
  });

  // =========================================================================
  // changePassword
  // =========================================================================
  describe('changePassword', () => {
    test('invalidates all sessions after password change', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin',
      };

      db.query
        .mockResolvedValueOnce([[user]])  // findById
        .mockResolvedValueOnce([])  // UPDATE password_hash
        .mockResolvedValueOnce([{ affectedRows: 3 }]);  // DELETE user_sessions

      bcrypt.compare.mockResolvedValueOnce(true);

      const result = await authService.changePassword(1, 'currentpass', 'newsecurepassword');
      expect(result.message).toBe('Password changed successfully');

      // Verify sessions were deleted
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM user_sessions WHERE user_id'),
        [1],
      );
    });

    test('throws when current password is wrong', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active',
      };
      db.query.mockResolvedValueOnce([[user]]);
      bcrypt.compare.mockResolvedValueOnce(false);

      await expect(
        authService.changePassword(1, 'wrongpass', 'newsecurepassword'),
      ).rejects.toThrow('Current password is incorrect');
    });

    test('throws when new password is too short', async () => {
      await expect(
        authService.changePassword(1, 'current', 'short'),
      ).rejects.toThrow('New password must be at least 8 characters');
    });

    test('throws when user not found', async () => {
      db.query.mockResolvedValueOnce([[]]);

      await expect(
        authService.changePassword(999, 'current', 'newsecurepass'),
      ).rejects.toThrow('User not found');
    });

    test('hashes new password with bcrypt', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active',
      };

      db.query
        .mockResolvedValueOnce([[user]])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      bcrypt.compare.mockResolvedValueOnce(true);

      await authService.changePassword(1, 'currentpass', 'newpassword123');

      expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 12);
    });
  });
});
