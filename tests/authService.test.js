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
  });

  // =========================================================================
  // login
  // =========================================================================
  describe('login', () => {
    test('returns token and user on successful login', async () => {
      const user = {
        id: 1, email: 'john@example.com', password_hash: '$2a$12$hashedpassword',
        status: 'active', role: 'admin', organization_id: 42,
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

      expect(result.token).toBeDefined();
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
      };
      db.query.mockResolvedValueOnce([[user]]);
      bcrypt.compare.mockResolvedValueOnce(false);

      await expect(
        authService.login({ email: 'john@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow('Invalid email or password');
    });
  });

  // =========================================================================
  // logout
  // =========================================================================
  describe('logout', () => {
    test('deletes session by token hash', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await authService.logout('some-jwt-token');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM user_sessions'),
        expect.any(Array),
      );
    });

    test('completes without error even if no session found', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      await expect(authService.logout('expired-token')).resolves.not.toThrow();
    });
  });
});
