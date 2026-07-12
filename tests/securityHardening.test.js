// =============================================================================
// FireISP 5.0 — Security hardening regression tests
// =============================================================================
// Locks in the fixes for the admin-bypass / privilege-escalation audit:
//   • /auth/register no longer honours a client-supplied role / organizationId
//   • users CRUD rejects role assignment by non-admins (restrictRoleAssignment)
//   • api-token user_id is forced to the authenticated creator
//   • validate({ strip:true }) drops undeclared keys (mass-assignment guard)
//   • GraphQL enforces RBAC permissions (not just org-scope)
//   • the insecure default JWT secret is fatal outside dev/test
// =============================================================================

const request = require('supertest');

// ---------------------------------------------------------------------------
// Mutable auth identity — each test sets mockCurrentUser before its request.
// (Variable name is `mock`-prefixed so Jest allows it inside the mock factory.)
// ---------------------------------------------------------------------------
let mockCurrentUser = { id: 1, email: 'admin@test.com', role: 'admin', organizationId: 1 };

const mockQuery = jest.fn();
jest.mock('../src/config/database', () => ({
  query:         (...a) => mockQuery(...a),
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockCurrentUser; req.userId = mockCurrentUser && mockCurrentUser.id; next(); },
  optionalAuth: (req, _res, next) => { req.user = mockCurrentUser; next(); },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = (mockCurrentUser && mockCurrentUser.organizationId) || 1; next(); },
}));

// Permission gate passes through — these tests isolate the NEW guards
// (restrictRoleAssignment, the GraphQL wrapper, user_id binding). The real
// requirePermission/enforceTokenScopes are covered by rbac.test.js.
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

const mockRegister = jest.fn();
jest.mock('../src/services/authService', () => ({
  register:      (...a) => mockRegister(...a),
  login:         jest.fn(),
  logout:        jest.fn(),
  refreshToken:  jest.fn(),
  changePassword: jest.fn(),
}));

const mockApiTokenCreate = jest.fn();
jest.mock('../src/models/ApiToken', () => ({
  tableName: 'api_tokens', hasOrgScope: true, softDelete: true,
  create:          (...a) => mockApiTokenCreate(...a),
  findAll:         jest.fn(),
  findById:        jest.fn(),
  findByIdOrFail:  jest.fn(),
  update:          jest.fn(),
}));

const app = require('../src/app');

describe('security hardening — integration', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([[]]);
    mockRegister.mockReset();
    mockRegister.mockResolvedValue({ id: 99, email: 'new@test.com', role: 'support' });
    mockApiTokenCreate.mockReset();
    mockApiTokenCreate.mockResolvedValue({ id: 1, name: 'tok' });
    mockCurrentUser = { id: 1, email: 'admin@test.com', role: 'admin', organizationId: 1 };
  });

  test('POST /auth/register ignores a client-supplied role and organizationId', async () => {
    mockCurrentUser = null; // public route, no auth
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ firstName: 'E', lastName: 'V', email: 'evil@test.com', password: 'longpassword123', role: 'admin', organizationId: 1 });

    expect(res.status).toBe(201);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    const arg = mockRegister.mock.calls[0][0];
    expect(arg).toEqual({ firstName: 'E', lastName: 'V', email: 'evil@test.com', password: 'longpassword123' });
    expect(arg.role).toBeUndefined();
    expect(arg.organizationId).toBeUndefined();
  });

  test('users CRUD blocks a non-admin from assigning role:admin', async () => {
    mockCurrentUser = { id: 5, role: 'support', organizationId: 1 };
    const res = await request(app)
      .post('/api/v1/users')
      .send({ first_name: 'X', last_name: 'Y', email: 'x@test.com', password: 'longpassword123', role: 'admin' });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/administrator may (assign or )?change a user/i);
  });

  test('users CRUD still lets an admin assign a role', async () => {
    // create() resolves via crudController -> Model.create -> db; just assert not 403.
    const res = await request(app)
      .post('/api/v1/users')
      .send({ first_name: 'A', last_name: 'B', email: 'a@test.com', password: 'longpassword123', role: 'support' });
    expect(res.status).not.toBe(403);
  });

  test('users CRUD blocks a non-admin from resetting another user\'s password (account takeover)', async () => {
    mockCurrentUser = { id: 5, role: 'support', organizationId: 1 };
    const res = await request(app).patch('/api/v1/users/1').send({ password: 'attacker-chosen-pw' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/password/i);
  });

  test('users CRUD blocks a non-admin from changing another user\'s email or status on update', async () => {
    mockCurrentUser = { id: 5, role: 'support', organizationId: 1 };
    const emailRes = await request(app).patch('/api/v1/users/1').send({ email: 'attacker@evil.test' });
    expect(emailRes.status).toBe(403);
    const statusRes = await request(app).patch('/api/v1/users/1').send({ status: 'active' });
    expect(statusRes.status).toBe(403);
  });

  test('but a non-admin CAN still edit non-privileged fields (name, phone) on update', async () => {
    mockCurrentUser = { id: 5, role: 'support', organizationId: 1 };
    const res = await request(app).patch('/api/v1/users/1').send({ first_name: 'Renamed', phone: '5550001' });
    expect(res.status).not.toBe(403);
  });

  test('POST /api-tokens binds user_id to the creator, not a client-supplied user_id', async () => {
    mockCurrentUser = { id: 5, role: 'support', organizationId: 1 };
    const res = await request(app)
      .post('/api/v1/api-tokens')
      .send({ name: 'evil', user_id: 1 }); // attacker tries to bind to admin user_id=1

    expect(res.status).toBe(201);
    expect(mockApiTokenCreate).toHaveBeenCalledTimes(1);
    const created = mockApiTokenCreate.mock.calls[0][0];
    expect(created.user_id).toBe(5);          // forced to the authenticated creator
    expect(created.organization_id).toBe(1);
  });

  test('GraphQL denies a non-admin lacking the required permission', async () => {
    mockCurrentUser = { id: 7, role: 'support', organizationId: 1 };
    mockQuery.mockResolvedValue([[]]); // User.getPermissions -> []
    const res = await request(app)
      .post('/api/v1/graphql')
      .set('Content-Type', 'application/json')
      .send({ query: '{ clients { id } }' });

    expect(res.status).toBe(200);
    expect(res.body.errors).toBeDefined();
    expect(JSON.stringify(res.body.errors)).toMatch(/forbidden/i);
  });
});

// ---------------------------------------------------------------------------
// Pure-unit guards (no app)
// ---------------------------------------------------------------------------
describe('validate({ strip })', () => {
  const { validate } = require('../src/middleware/validate');
  const run = (mw, body) => { const req = { body }; let err; mw(req, {}, (e) => { err = e; }); return { req, err }; };

  test('drops keys not declared in the schema', () => {
    const mw = validate({ name: { type: 'string', required: true } }, { strip: true });
    const { req, err } = run(mw, { name: 'ok', role: 'admin', user_id: 1 });
    expect(err).toBeUndefined();
    expect(req.body).toEqual({ name: 'ok' });
  });

  test('keeps undeclared keys when strip is off (default)', () => {
    const mw = validate({ name: { type: 'string', required: true } });
    const { req } = run(mw, { name: 'ok', extra: 1 });
    expect(req.body.extra).toBe(1);
  });
});

describe('restrictRoleAssignment', () => {
  const { restrictRoleAssignment } = require('../src/middleware/restrictRoleAssignment');

  test('blocks a non-admin from setting role', () => {
    let err; restrictRoleAssignment({ user: { role: 'support' }, body: { role: 'admin' } }, {}, (e) => { err = e; });
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/administrator may (assign or )?change a user/i);
  });

  test('allows an admin to set role', () => {
    let called = false; restrictRoleAssignment({ user: { role: 'admin' }, body: { role: 'admin' } }, {}, () => { called = true; });
    expect(called).toBe(true);
  });

  test('allows requests that do not touch role', () => {
    let called = false; restrictRoleAssignment({ user: { role: 'support' }, body: { first_name: 'X' } }, {}, () => { called = true; });
    expect(called).toBe(true);
  });

  test('blocks a non-admin from changing password/email/status on UPDATE', () => {
    for (const field of ['password', 'email', 'status']) {
      for (const method of ['PUT', 'PATCH']) {
        let err;
        restrictRoleAssignment({ method, user: { role: 'support' }, body: { [field]: 'x' } }, {}, (e) => { err = e; });
        expect(err).toBeTruthy();
      }
    }
  });

  test('ALLOWS a non-admin to set password/email/status as INITIAL values on CREATE (POST)', () => {
    let called = false;
    restrictRoleAssignment(
      { method: 'POST', user: { role: 'support' }, body: { email: 'new@x.test', password: 'longpassword123', status: 'active' } },
      {}, () => { called = true; },
    );
    expect(called).toBe(true);
  });

  test('still blocks role/group_id/organization_ids even on CREATE', () => {
    for (const field of [['role', 'admin'], ['group_id', 1], ['organization_ids', [1, 2]]]) {
      let err;
      restrictRoleAssignment({ method: 'POST', user: { role: 'support' }, body: { [field[0]]: field[1] } }, {}, (e) => { err = e; });
      expect(err).toBeTruthy();
    }
  });
});

describe('validateEnv — insecure default JWT secret', () => {
  const savedNodeEnv = process.env.NODE_ENV;
  const savedSecret = process.env.JWT_SECRET;
  afterEach(() => {
    process.env.NODE_ENV = savedNodeEnv;
    if (savedSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = savedSecret;
    jest.resetModules();
  });

  test('is fatal in a non dev/test environment (e.g. staging)', () => {
    process.env.NODE_ENV = 'staging';
    delete process.env.JWT_SECRET;
    jest.resetModules();
    const config = require('../src/config');
    expect(() => config.validateEnv(null)).toThrow(/Fatal configuration|JWT_SECRET/);
  });

  test('only warns in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    jest.resetModules();
    const config = require('../src/config');
    const warn = jest.fn();
    expect(() => config.validateEnv({ warn })).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
