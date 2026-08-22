jest.mock('jsonwebtoken');
jest.mock('../src/config', () => ({
  jwt: { secret: 'test-jwt-secret', algorithm: 'HS256' },
}));
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn((callback) => callback()),
}));
jest.mock('../src/models/User', () => ({
  findById: jest.fn(),
}));
jest.mock('../src/services/orgPrincipalService', () => ({
  resolveOrgPrincipal: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const db = require('../src/config/database');
const User = require('../src/models/User');
const { resolveOrgPrincipal } = require('../src/services/orgPrincipalService');
const { authenticate, optionalAuth } = require('../src/middleware/auth');

function mockReqRes(overrides = {}) {
  const req = {
    headers: {},
    cookies: {},
    ip: '127.0.0.1',
    ...overrides,
  };
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('auth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveOrgPrincipal.mockImplementation(async (user, requestedOrganizationId) => ({
      organizationId: Number(requestedOrganizationId || user.organization_id),
      membershipRole: user.role,
      authorizationRole: user.role,
      isInstallOperator: false,
      isSuperAdmin: false,
      hasGlobalOrganizationAccess: false,
    }));
  });

  // =========================================================================
  // authenticate – JWT path
  // =========================================================================
  describe('authenticate – JWT', () => {
    test('rejects when no Authorization header, no X-API-Key, and no cookie', async () => {
      const { req, res, next } = mockReqRes();

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('rejects when Authorization header does not start with Bearer', async () => {
      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Basic abc123' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('rejects on invalid JWT', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer bad-token' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('rejects when JWT user is not found', async () => {
      jwt.verify.mockReturnValue({ sub: 99 });
      User.findById.mockResolvedValueOnce(null);

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer valid-token' },
      });

      await authenticate(req, res, next);

      expect(User.findById).toHaveBeenCalledWith(99);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('rejects when JWT user is inactive', async () => {
      jwt.verify.mockReturnValue({ sub: 1 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'user@example.com',
        role: 'admin',
        status: 'suspended',
        organization_id: 10,
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer valid-token' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('succeeds on valid JWT and attaches req.user', async () => {
      jwt.verify.mockReturnValue({ sub: 1 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'user@example.com',
        role: 'admin',
        status: 'active',
        organization_id: 10,
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer valid-token' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({
        id: 1,
        email: 'user@example.com',
        role: 'admin',
        membershipRole: 'admin',
        organizationId: 10,
        isInstallOperator: false,
        isSuperAdmin: false,
        hasGlobalOrganizationAccess: false,
      });
    });

    test('uses orgId from JWT payload when present', async () => {
      jwt.verify.mockReturnValue({ sub: 1, orgId: 77 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'user@example.com',
        role: 'tech',
        status: 'active',
        organization_id: 10,
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer valid-token' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user.organizationId).toBe(77);
    });

    test('falls back to user.organization_id when no orgId in payload', async () => {
      jwt.verify.mockReturnValue({ sub: 1 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'user@example.com',
        role: 'tech',
        status: 'active',
        organization_id: 42,
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer valid-token' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user.organizationId).toBe(42);
    });

    test('passes token string (without "Bearer ") to jwt.verify', async () => {
      jwt.verify.mockReturnValue({ sub: 1 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'a@b.com',
        role: 'user',
        status: 'active',
        organization_id: 1,
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer my-secret-token' },
      });

      await authenticate(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('my-secret-token', 'test-jwt-secret', { algorithms: ['HS256'] });
    });
  });

  // =========================================================================
  // authenticate – httpOnly cookie path (P3.4)
  // =========================================================================
  describe('authenticate – httpOnly cookie', () => {
    test('succeeds when JWT is provided via fireisp_access cookie', async () => {
      jwt.verify.mockReturnValue({ sub: 1, orgId: 5 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'cookie@example.com',
        role: 'admin',
        status: 'active',
        organization_id: 5,
      });

      const { req, res, next } = mockReqRes({
        cookies: { fireisp_access: 'cookie-jwt-token' },
      });

      await authenticate(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('cookie-jwt-token', 'test-jwt-secret', { algorithms: ['HS256'] });
      expect(next).toHaveBeenCalledWith();
      expect(req.user).toMatchObject({ id: 1, email: 'cookie@example.com', organizationId: 5 });
    });

    test('rejects when cookie JWT is invalid', async () => {
      jwt.verify.mockImplementation(() => { throw new Error('jwt malformed'); });

      const { req, res, next } = mockReqRes({
        cookies: { fireisp_access: 'bad-cookie-jwt' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('Bearer header takes precedence over cookie when both are present', async () => {
      jwt.verify.mockReturnValue({ sub: 1 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'bearer@example.com',
        role: 'admin',
        status: 'active',
        organization_id: 1,
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer bearer-wins' },
        cookies: { fireisp_access: 'cookie-loses' },
      });

      await authenticate(req, res, next);

      // Must use the Bearer token string, not the cookie value
      expect(jwt.verify).toHaveBeenCalledWith('bearer-wins', 'test-jwt-secret', { algorithms: ['HS256'] });
      expect(next).toHaveBeenCalledWith();
    });

    test('optionalAuth delegates to authenticate when only cookie is present', async () => {
      jwt.verify.mockReturnValue({ sub: 2, orgId: 9 });
      User.findById.mockResolvedValueOnce({
        id: 2,
        email: 'cookie-optional@example.com',
        role: 'support',
        status: 'active',
        organization_id: 9,
      });

      const { req, res, next } = mockReqRes({
        cookies: { fireisp_access: 'optional-cookie-jwt' },
      });

      await optionalAuth(req, res, next);

      expect(jwt.verify).toHaveBeenCalledWith('optional-cookie-jwt', 'test-jwt-secret', { algorithms: ['HS256'] });
      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeDefined();
    });
  });

  // =========================================================================
  // authenticate – API token path
  // =========================================================================
  describe('authenticate – API token', () => {
    const validTokenRow = {
      id: 500,
      user_id: 3,
      email: 'api@example.com',
      role: 'admin',
      status: 'active',
      token_organization_id: 20,
      user_home_organization_id: 20,
      is_install_operator: 0,
      scopes: 'read,write',
      scopes_sql_null: 0,
    };

    test('succeeds with valid API token', async () => {
      db.query.mockResolvedValueOnce([[validTokenRow]]).mockResolvedValueOnce([]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'my-api-key' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({
        id: 3,
        email: 'api@example.com',
        role: 'admin',
        membershipRole: 'admin',
        organizationId: 20,
        isInstallOperator: false,
        isSuperAdmin: false,
        hasGlobalOrganizationAccess: false,
        apiTokenId: 500,
        scopes: 'read,write',
        scopesSqlNull: false,
        apiTokenRateLimitPolicy: null,
      });
    });

    test('rejects when API token is not found in database', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'unknown-key' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('rejects when API token user is inactive', async () => {
      db.query.mockResolvedValueOnce([
        [{ ...validTokenRow, status: 'suspended' }],
      ]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'my-api-key' },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401 }),
      );
    });

    test('updates last_used_at and last_used_ip on success', async () => {
      db.query.mockResolvedValueOnce([[validTokenRow]]).mockResolvedValueOnce([]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'my-api-key' },
        ip: '10.0.0.5',
      });

      await authenticate(req, res, next);

      expect(db.query).toHaveBeenCalledTimes(2);
      const updateCall = db.query.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE api_tokens');
      expect(updateCall[0]).toContain('last_used_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE)');
      expect(updateCall[1]).toEqual(['10.0.0.5', 500, '10.0.0.5']);
    });

    test('does not write last-used tracking again within one minute for the same IP', async () => {
      db.query.mockResolvedValueOnce([[
        {
          ...validTokenRow,
          last_used_at: new Date(),
          last_used_ip: '10.0.0.5',
        },
      ]]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'my-api-key' },
        ip: '10.0.0.5',
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(db.query.mock.calls[0][0]).toContain('LEFT JOIN api_key_rate_limits');
    });

    test('attaches the rate-limit policy selected with live token authentication', async () => {
      db.query.mockResolvedValueOnce([[
        {
          ...validTokenRow,
          rate_limit_policy_id: 7,
          requests_per_minute: 12,
          requests_per_hour: 100,
          requests_per_day: 1000,
          burst_size: 3,
          rate_limit_policy_active: 1,
        },
      ]]).mockResolvedValueOnce([]);

      const { req, res, next } = mockReqRes({ headers: { 'x-api-key': 'my-api-key' } });
      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user.apiTokenRateLimitPolicy).toEqual({
        requests_per_minute: 12,
        requests_per_hour: 100,
        requests_per_day: 1000,
        burst_size: 3,
        is_active: 1,
      });
    });

    test('attaches scopes to req.user', async () => {
      const tokenWithScopes = { ...validTokenRow, scopes: 'billing,support' };
      db.query.mockResolvedValueOnce([[tokenWithScopes]]).mockResolvedValueOnce([]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'some-key' },
      });

      await authenticate(req, res, next);

      expect(req.user.scopes).toBe('billing,support');
    });

    test('sets scopes to null when token has no scopes', async () => {
      const tokenNoScopes = { ...validTokenRow, scopes: null, scopes_sql_null: 1 };
      db.query.mockResolvedValueOnce([[tokenNoScopes]]).mockResolvedValueOnce([]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'some-key' },
      });

      await authenticate(req, res, next);

      expect(req.user.scopes).toBeNull();
    });

    test('API token takes precedence over Bearer header', async () => {
      db.query.mockResolvedValueOnce([[validTokenRow]]).mockResolvedValueOnce([]);

      const { req, res, next } = mockReqRes({
        headers: {
          'x-api-key': 'my-api-key',
          authorization: 'Bearer some-jwt',
        },
      });

      await authenticate(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(jwt.verify).not.toHaveBeenCalled();
      expect(req.user.apiTokenId).toBe(500);
    });
  });

  // =========================================================================
  // optionalAuth
  // =========================================================================
  describe('optionalAuth', () => {
    test('calls next() without error when no auth headers', async () => {
      const { req, res, next } = mockReqRes();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeUndefined();
    });

    test('delegates to authenticate when Bearer header present', async () => {
      jwt.verify.mockReturnValue({ sub: 1 });
      User.findById.mockResolvedValueOnce({
        id: 1,
        email: 'u@x.com',
        role: 'user',
        status: 'active',
        organization_id: 5,
      });

      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Bearer valid' },
      });

      await optionalAuth(req, res, next);

      expect(jwt.verify).toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeDefined();
    });

    test('delegates to authenticate when X-API-Key present', async () => {
      const tokenRow = {
        id: 1,
        user_id: 2,
        email: 'a@b.com',
        role: 'user',
        status: 'active',
        token_organization_id: 3,
        user_home_organization_id: 3,
        is_install_operator: 0,
        scopes: null,
        scopes_sql_null: 1,
      };
      db.query.mockResolvedValueOnce([[tokenRow]]).mockResolvedValueOnce([]);

      const { req, res, next } = mockReqRes({
        headers: { 'x-api-key': 'key123' },
      });

      await optionalAuth(req, res, next);

      expect(db.query).toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
      expect(req.user).toBeDefined();
    });

    test('skips auth when Authorization header is not Bearer scheme', async () => {
      const { req, res, next } = mockReqRes({
        headers: { authorization: 'Basic credentials' },
      });

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(jwt.verify).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    });
  });
});
