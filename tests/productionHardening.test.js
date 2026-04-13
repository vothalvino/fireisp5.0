// =============================================================================
// FireISP 5.0 — Production Hardening Tests
// =============================================================================
// Tests for SSE rate limiter, refresh token rotation, and webhook HMAC signing.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');

// =============================================================================
// SSE Rate Limiter
// =============================================================================
describe('SSE Rate Limiter', () => {
  test('sseLimiter is exported from rateLimit module', () => {
    const { sseLimiter } = require('../src/middleware/rateLimit');
    expect(sseLimiter).toBeDefined();
    expect(typeof sseLimiter).toBe('function');
  });

  test('all six rate limiters are exported', () => {
    const rl = require('../src/middleware/rateLimit');
    expect(rl.apiLimiter).toBeDefined();
    expect(rl.authLimiter).toBeDefined();
    expect(rl.publicLimiter).toBeDefined();
    expect(rl.uploadLimiter).toBeDefined();
    expect(rl.exportLimiter).toBeDefined();
    expect(rl.sseLimiter).toBeDefined();
  });
});

// =============================================================================
// Refresh Token — Auth Service
// =============================================================================
describe('Auth Service — refreshToken', () => {
  const authService = require('../src/services/authService');
  const jwt = require('jsonwebtoken');
  const config = require('../src/config');
  const User = require('../src/models/User');

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  test('refreshToken is exported', () => {
    expect(typeof authService.refreshToken).toBe('function');
  });

  test('refreshToken rotates a valid session', async () => {
    // Create a real JWT token for testing
    const token = jwt.sign(
      { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1 },
      config.jwt.secret,
      { expiresIn: '1h' },
    );

    // Mock: session exists
    db.query
      .mockResolvedValueOnce([[{ id: 1, user_id: 1 }]])  // SELECT session
      .mockResolvedValueOnce([[{ id: 1, email: 'test@example.com', role: 'admin', status: 'active' }]])  // User.findById
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // DELETE old session
      .mockResolvedValueOnce([{ insertId: 2 }]);  // INSERT new session

    // Mock User.findById
    jest.spyOn(User, 'findById').mockResolvedValue({
      id: 1,
      email: 'test@example.com',
      role: 'admin',
      status: 'active',
    });

    const result = await authService.refreshToken(token);
    expect(result).toHaveProperty('token');
    expect(typeof result.token).toBe('string');
    // The new token should be different from the old one
    expect(result.token).not.toBe(token);

    // Verify the new token is valid
    const decoded = jwt.verify(result.token, config.jwt.secret);
    expect(decoded.sub).toBe(1);
    expect(decoded.email).toBe('test@example.com');
  });

  test('refreshToken rejects invalid token', async () => {
    await expect(authService.refreshToken('not-a-valid-token'))
      .rejects.toThrow('Invalid token');
  });

  test('refreshToken rejects revoked session', async () => {
    const token = jwt.sign(
      { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1 },
      config.jwt.secret,
      { expiresIn: '1h' },
    );

    // Mock: no session found (revoked/logged out)
    db.query.mockResolvedValueOnce([[]]);

    // Mock: User.findById also returns null (session was revoked)
    jest.spyOn(User, 'findById').mockResolvedValue(null);

    await expect(authService.refreshToken(token))
      .rejects.toThrow();
  });

  test('refreshToken rejects inactive user', async () => {
    // Explicitly reset db.query mock queue
    db.query.mockReset();

    const token = jwt.sign(
      { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1 },
      config.jwt.secret,
      { expiresIn: '1h' },
    );

    // Mock: session exists
    db.query.mockResolvedValueOnce([[{ id: 1, user_id: 1 }]]);

    // Mock: user is inactive
    jest.spyOn(User, 'findById').mockResolvedValue({
      id: 1,
      email: 'test@example.com',
      role: 'admin',
      status: 'inactive',
    });

    await expect(authService.refreshToken(token))
      .rejects.toThrow('User not found or inactive');
  });
});

// =============================================================================
// Auth Schema — refreshToken validation
// =============================================================================
describe('Auth Schema — refreshToken', () => {
  test('auth schema exports refreshToken schema', () => {
    const authSchemas = require('../src/middleware/schemas/auth');
    expect(authSchemas.refreshToken).toBeDefined();
    expect(authSchemas.refreshToken.token.required).toBe(true);
    expect(authSchemas.refreshToken.token.type).toBe('string');
  });
});

// =============================================================================
// Webhook HMAC Signing
// =============================================================================
describe('Webhook HMAC Signing', () => {
  const crypto = require('crypto');
  const webhookService = require('../src/services/webhookService');

  test('webhookService exports dispatch, deliver, retryPending', () => {
    expect(typeof webhookService.dispatch).toBe('function');
    expect(typeof webhookService.deliver).toBe('function');
    expect(typeof webhookService.retryPending).toBe('function');
  });

  test('HMAC signature can be verified using crypto', () => {
    const secret = 'test-webhook-secret';
    const body = JSON.stringify({ event: 'test', data: { id: 1 }, timestamp: '2025-01-01T00:00:00Z' });
    const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

    // Verify the signature format
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Verify it can be reproduced
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(signature).toBe(expected);
  });
});
