// =============================================================================
// FireISP 5.0 — SSO Service & Routes Tests (P2.1)
// =============================================================================

// ---------------------------------------------------------------------------
// Mock database
// ---------------------------------------------------------------------------
const mockQuery      = jest.fn();
const mockGetConn    = jest.fn();
const mockConnQuery  = jest.fn();
const mockConnRelease = jest.fn();

jest.mock('../src/config/database', () => ({
  query:         mockQuery,
  execute:       jest.fn(),
  getConnection: mockGetConn,
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Mock auth + org middleware
// ---------------------------------------------------------------------------
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, email: 'admin@test.com', role: 'admin', organizationId: 1 };
    next();
  },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

// ---------------------------------------------------------------------------
// Enable SSO feature flag
// ---------------------------------------------------------------------------
jest.mock('../src/config', () => ({
  env:    'test',
  appUrl: 'http://localhost:3000',
  jwt: {
    secret:           'test-secret-that-is-64-chars-long-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    accessExpiresIn:  '15m',
    refreshExpiresIn: '7d',
    algorithm:        'HS256',
  },
  rateLimit:          { windowMs: 900000, api: 200, auth: 20, public: 60, upload: 30, export: 20, sse: 10, webhook: 100, tenantWindowMs: 900000, tenantApi: 500 },
  requestTimeoutMs:   0,
  corsOrigins:        '',
  adminIpAllowlist:   '',
  log:                { level: 'silent' },
  features: {
    cfdi: false, radius: false, twoFactor: false, webhooks: false, snmp: false,
    sso: true,
  },
}));

// ---------------------------------------------------------------------------
// Pull in service + app AFTER mocks are in place
// ---------------------------------------------------------------------------
const ssoService = require('../src/services/ssoService');
const request    = require('supertest');
const app        = require('../src/app');

// ============================================================================
// Unit tests — ssoService helpers
// ============================================================================

describe('ssoService.parseAttributeMapping', () => {
  const { parseAttributeMapping } = ssoService;

  test('returns {} for null', () => {
    expect(parseAttributeMapping(null)).toEqual({});
  });

  test('returns the object if already parsed', () => {
    const obj = { email: 'mail' };
    expect(parseAttributeMapping(obj)).toBe(obj);
  });

  test('parses a JSON string', () => {
    expect(parseAttributeMapping('{"email":"mail"}')).toEqual({ email: 'mail' });
  });

  test('returns {} for invalid JSON', () => {
    expect(parseAttributeMapping('not-json')).toEqual({});
  });
});

describe('ssoService.normalizeSamlProfile', () => {
  const { normalizeSamlProfile } = ssoService;

  test('extracts email from standard SAML attribute', () => {
    const profile = {
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'u@example.com',
      groups: ['admins'],
    };
    const r = normalizeSamlProfile(profile, {}, 'groups');
    expect(r.email).toBe('u@example.com');
    expect(r.groups).toEqual(['admins']);
  });

  test('uses mapped attribute names', () => {
    const profile = { customEmail: 'mapped@example.com', customGroups: ['g1', 'g2'] };
    const attrMap = { email: 'customEmail' };
    const r = normalizeSamlProfile(profile, attrMap, 'customGroups');
    expect(r.email).toBe('mapped@example.com');
    expect(r.groups).toEqual(['g1', 'g2']);
  });

  test('wraps single group string in an array', () => {
    const profile = { email: 'a@b.com', groups: 'single-group' };
    const r = normalizeSamlProfile(profile, {}, 'groups');
    expect(r.groups).toEqual(['single-group']);
  });

  test('returns empty groups array when attribute absent', () => {
    const profile = { email: 'a@b.com' };
    const r = normalizeSamlProfile(profile, {}, 'groups');
    expect(r.groups).toEqual([]);
  });
});

describe('ssoService.normalizeOidcProfile', () => {
  const { normalizeOidcProfile } = ssoService;

  test('extracts standard OIDC claims', () => {
    const userinfo = { email: 'u@ex.com', given_name: 'Alice', family_name: 'Smith', groups: ['dev'] };
    const r = normalizeOidcProfile(userinfo, {}, 'groups');
    expect(r.email).toBe('u@ex.com');
    expect(r.firstName).toBe('Alice');
    expect(r.lastName).toBe('Smith');
    expect(r.groups).toEqual(['dev']);
  });

  test('falls back to preferred_username for email', () => {
    const userinfo = { preferred_username: 'alice', given_name: 'Alice', family_name: 'Smith' };
    const r = normalizeOidcProfile(userinfo, {}, 'groups');
    expect(r.email).toBe('alice');
  });

  test('uses attribute mapping overrides', () => {
    const userinfo = { mail: 'mapped@ex.com', fn: 'Bob', ln: 'Jones' };
    const attrMap = { email: 'mail', firstName: 'fn', lastName: 'ln' };
    const r = normalizeOidcProfile(userinfo, attrMap, 'groups');
    expect(r.email).toBe('mapped@ex.com');
    expect(r.firstName).toBe('Bob');
    expect(r.lastName).toBe('Jones');
  });

  test('returns empty groups when no group attribute present', () => {
    const userinfo = { email: 'a@b.com' };
    const r = normalizeOidcProfile(userinfo, {}, 'groups');
    expect(r.groups).toEqual([]);
  });
});

// ============================================================================
// Unit tests — ssoService.findOrCreateSsoUser
// ============================================================================

describe('ssoService.findOrCreateSsoUser', () => {
  const ORG_ID = 1;
  const CFG_ENABLED = { id: 10, is_enabled: 1, auto_provision: 1, default_role: 'readonly' };
  const PROFILE     = { email: 'user@example.com', firstName: 'Jane', lastName: 'Doe', groups: ['admins'] };
  const MAPPINGS    = [{ idp_group: 'admins', fireisp_role: 'admin' }];

  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('returns existing user with role from group mapping', async () => {
    const existingUser = { id: 5, email: 'user@example.com', role: 'support', status: 'active' };
    // 1. findByEmail query
    mockQuery.mockResolvedValueOnce([[existingUser]]);
    // 2. upsert org membership
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const { user, orgRole } = await ssoService.findOrCreateSsoUser(ORG_ID, PROFILE, CFG_ENABLED, MAPPINGS);
    expect(user.id).toBe(5);
    expect(orgRole).toBe('admin');
  });

  test('uses default_role when no group matches', async () => {
    const existingUser = { id: 5, email: 'user@example.com', role: 'support', status: 'active' };
    mockQuery.mockResolvedValueOnce([[existingUser]]);
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const noMatchMappings = [{ idp_group: 'other-group', fireisp_role: 'manager' }];
    const { orgRole } = await ssoService.findOrCreateSsoUser(ORG_ID, PROFILE, CFG_ENABLED, noMatchMappings);
    expect(orgRole).toBe('readonly');
  });

  test('auto-provisions a new user when not found', async () => {
    // findByEmail → not found
    mockQuery.mockResolvedValueOnce([[]]); // user not found
    // INSERT user
    mockQuery.mockResolvedValueOnce([{ insertId: 99 }]);
    // SELECT new user
    mockQuery.mockResolvedValueOnce([[{ id: 99, email: 'user@example.com', role: 'support', password_hash: 'x' }]]);
    // upsert org membership
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);

    const { user, orgRole } = await ssoService.findOrCreateSsoUser(ORG_ID, PROFILE, CFG_ENABLED, MAPPINGS);
    expect(user.id).toBe(99);
    expect(orgRole).toBe('admin');
  });

  test('throws UnauthorizedError when auto_provision=false and user not found', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // user not found

    const cfgNoProvision = { ...CFG_ENABLED, auto_provision: 0 };
    await expect(
      ssoService.findOrCreateSsoUser(ORG_ID, PROFILE, cfgNoProvision, []),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  test('throws UnauthorizedError when profile has no email', async () => {
    const badProfile = { email: '', firstName: 'X', lastName: 'Y', groups: [] };
    await expect(
      ssoService.findOrCreateSsoUser(ORG_ID, badProfile, CFG_ENABLED, []),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ============================================================================
// Unit tests — ssoService.mintTokens
// ============================================================================

describe('ssoService.mintTokens', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns accessToken, refreshToken, expiresIn, user, organizations', async () => {
    const user = { id: 1, email: 'a@b.com', role: 'admin', status: 'active' };
    // INSERT session
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);
    // UPDATE last_login_at
    mockQuery.mockResolvedValueOnce([{}]);
    // SELECT organizations
    mockQuery.mockResolvedValueOnce([[{ id: 1, name: 'Acme', membership_role: 'admin' }]]);

    const result = await ssoService.mintTokens(user, 1);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toHaveLength(64); // 32 bytes hex
    expect(result.expiresIn).toBeGreaterThan(0);
    expect(result.user).not.toHaveProperty('password_hash');
    expect(result.organizations).toHaveLength(1);
  });
});

// ============================================================================
// Unit tests — ssoService.getConfig / saveConfig
// ============================================================================

describe('ssoService.getConfig', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns null when no config exists', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // empty result
    const cfg = await ssoService.getConfig(1, 'saml');
    expect(cfg).toBeNull();
  });

  test('returns row when config exists', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1, organization_id: 1, provider_type: 'saml', is_enabled: 1 }]]);
    const cfg = await ssoService.getConfig(1, 'saml');
    expect(cfg.id).toBe(1);
  });
});

describe('ssoService.saveConfig', () => {
  beforeEach(() => mockQuery.mockReset());

  test('creates a new config row when none exists', async () => {
    // existing check → not found
    mockQuery.mockResolvedValueOnce([[]]); // SELECT id
    // INSERT
    mockQuery.mockResolvedValueOnce([{ insertId: 5 }]);
    // getConfig after save
    mockQuery.mockResolvedValueOnce([[{ id: 5, organization_id: 1, provider_type: 'saml', is_enabled: 1 }]]);

    const result = await ssoService.saveConfig(1, 'saml', { is_enabled: true });
    expect(result.id).toBe(5);
  });

  test('updates an existing config row', async () => {
    // existing check → found
    mockQuery.mockResolvedValueOnce([[{ id: 3 }]]);
    // UPDATE
    mockQuery.mockResolvedValueOnce([{ affectedRows: 1 }]);
    // getConfig after save
    mockQuery.mockResolvedValueOnce([[{ id: 3, organization_id: 1, provider_type: 'oidc', is_enabled: 0 }]]);

    const result = await ssoService.saveConfig(1, 'oidc', { is_enabled: false });
    expect(result.id).toBe(3);
  });
});

// ============================================================================
// Unit tests — ssoService.getGroupMappings / saveGroupMappings
// ============================================================================

describe('ssoService.getGroupMappings', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns sorted mappings for a config', async () => {
    const rows = [
      { id: 1, idp_group: 'admins', fireisp_role: 'admin' },
      { id: 2, idp_group: 'staff',  fireisp_role: 'technician' },
    ];
    mockQuery.mockResolvedValueOnce([rows]);
    const result = await ssoService.getGroupMappings(10);
    expect(result).toHaveLength(2);
    expect(result[0].idp_group).toBe('admins');
  });
});

describe('ssoService.saveGroupMappings', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetConn.mockResolvedValue({
      query:   mockConnQuery,
      release: mockConnRelease,
    });
    mockConnQuery.mockResolvedValue([{}]);
  });

  test('replaces all mappings in a transaction', async () => {
    // After save, getGroupMappings query
    mockQuery.mockResolvedValueOnce([[{ id: 1, idp_group: 'g1', fireisp_role: 'admin' }]]);

    const mappings = [{ idp_group: 'g1', fireisp_role: 'admin' }];
    const result = await ssoService.saveGroupMappings(10, mappings);
    expect(mockConnQuery).toHaveBeenCalledWith('START TRANSACTION');
    expect(mockConnQuery).toHaveBeenCalledWith('COMMIT');
    expect(result).toHaveLength(1);
  });

  test('rolls back on error', async () => {
    mockConnQuery
      .mockResolvedValueOnce([{}])  // START TRANSACTION
      .mockResolvedValueOnce([{}])  // DELETE
      .mockRejectedValueOnce(new Error('DB error')); // INSERT fails

    await expect(ssoService.saveGroupMappings(10, [{ idp_group: 'g', fireisp_role: 'admin' }]))
      .rejects.toThrow('DB error');
    expect(mockConnQuery).toHaveBeenCalledWith('ROLLBACK');
  });
});

// ============================================================================
// Unit tests — ssoService.purgeExpiredStates
// ============================================================================

describe('ssoService.purgeExpiredStates', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns number of deleted rows', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 3 }]);
    const n = await ssoService.purgeExpiredStates();
    expect(n).toBe(3);
  });

  test('returns 0 when no expired rows', async () => {
    mockQuery.mockResolvedValueOnce([{ affectedRows: 0 }]);
    const n = await ssoService.purgeExpiredStates();
    expect(n).toBe(0);
  });
});

// ============================================================================
// Integration tests — SSO routes via supertest
// ============================================================================

describe('SSO routes — feature disabled returns 404', () => {
  let savedFeature;

  beforeAll(() => {
    savedFeature = require('../src/config').features.sso;
    require('../src/config').features.sso = false;
  });

  afterAll(() => {
    require('../src/config').features.sso = savedFeature;
  });

  test('GET /api/v1/sso/1/saml/config returns 404 when SSO disabled', async () => {
    const res = await request(app).get('/api/v1/sso/1/saml/config');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });
});

describe('GET /api/v1/sso/:orgId/saml/config', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns 404 when no SAML config exists', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // getConfig → not found
    const res = await request(app).get('/api/v1/sso/1/saml/config');
    expect(res.status).toBe(404);
  });

  test('returns config without private key fields', async () => {
    mockQuery.mockResolvedValueOnce([[{
      id: 1, organization_id: 1, provider_type: 'saml', is_enabled: 1,
      saml_entity_id: 'urn:example', saml_sp_private_key: 'secret-key', oidc_client_secret: null,
    }]]);
    const res = await request(app).get('/api/v1/sso/1/saml/config');
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('saml_sp_private_key');
    expect(res.body.data).not.toHaveProperty('oidc_client_secret');
  });
});

describe('PUT /api/v1/sso/:orgId/saml/config', () => {
  beforeEach(() => mockQuery.mockReset());

  test('creates SAML config and returns 200', async () => {
    // saveConfig: existing check → not found → INSERT → getConfig
    mockQuery
      .mockResolvedValueOnce([[]])                    // SELECT id (not found)
      .mockResolvedValueOnce([{ insertId: 7 }])       // INSERT
      .mockResolvedValueOnce([[{ id: 7, organization_id: 1, provider_type: 'saml', is_enabled: 1 }]]); // getConfig

    const res = await request(app)
      .put('/api/v1/sso/1/saml/config')
      .send({ is_enabled: true, saml_sso_url: 'https://idp.example.com/sso' });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(7);
  });
});

describe('GET /api/v1/sso/:orgId/saml/group-mappings', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns 404 when SAML config not found', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // getConfig → not found
    const res = await request(app).get('/api/v1/sso/1/saml/group-mappings');
    expect(res.status).toBe(404);
  });

  test('returns group mappings list', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 1, organization_id: 1, provider_type: 'saml' }]]) // getConfig
      .mockResolvedValueOnce([[{ id: 1, idp_group: 'admins', fireisp_role: 'admin' }]]); // getGroupMappings
    const res = await request(app).get('/api/v1/sso/1/saml/group-mappings');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].idp_group).toBe('admins');
  });
});

describe('PUT /api/v1/sso/:orgId/saml/group-mappings', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetConn.mockReset();
    mockConnQuery.mockReset();
    mockGetConn.mockResolvedValue({ query: mockConnQuery, release: mockConnRelease });
    mockConnQuery.mockResolvedValue([{}]);
  });

  test('replaces group mappings and returns 200', async () => {
    mockQuery
      .mockResolvedValueOnce([[{ id: 1, organization_id: 1, provider_type: 'saml' }]]) // getConfig
      .mockResolvedValueOnce([[{ id: 1, idp_group: 'admins', fireisp_role: 'admin' }]]); // getGroupMappings after save

    const res = await request(app)
      .put('/api/v1/sso/1/saml/group-mappings')
      .send({ mappings: [{ idp_group: 'admins', fireisp_role: 'admin' }] });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/v1/sso/:orgId/oidc/config', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns 404 when no OIDC config exists', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // getConfig → not found
    const res = await request(app).get('/api/v1/sso/1/oidc/config');
    expect(res.status).toBe(404);
  });

  test('returns OIDC config without client_secret', async () => {
    mockQuery.mockResolvedValueOnce([[{
      id: 2, organization_id: 1, provider_type: 'oidc', is_enabled: 1,
      oidc_issuer: 'https://accounts.example.com', oidc_client_id: 'client-id',
      oidc_client_secret: 'encrypted-secret', saml_sp_private_key: null,
    }]]);
    const res = await request(app).get('/api/v1/sso/1/oidc/config');
    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('oidc_client_secret');
    expect(res.body.data.oidc_issuer).toBe('https://accounts.example.com');
  });
});

describe('GET /api/v1/sso/0/saml/config — invalid orgId', () => {
  test('returns 400 for orgId=0', async () => {
    const res = await request(app).get('/api/v1/sso/0/saml/config');
    expect(res.status).toBe(400);
  });
});

describe('SSO saml/login — feature enabled, config missing', () => {
  beforeEach(() => mockQuery.mockReset());

  test('returns 403 when SAML config not found', async () => {
    mockQuery.mockResolvedValueOnce([[]]); // getConfig → not found
    const res = await request(app).get('/api/v1/sso/1/saml/login');
    // ForbiddenError (cfg not found / not enabled) → 403
    expect(res.status).toBe(403);
  });
});
