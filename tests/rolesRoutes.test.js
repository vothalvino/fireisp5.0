// =============================================================================
// FireISP 5.0 — Role (User Group) Routes Tests
// =============================================================================
// Covers the migration-378 hardening of src/routes/roles.js:
//   - createRole/updateRole require/accept `kind`, excluding 'admin' for
//     custom groups (an admin-kind custom group would trip the legacy RBAC
//     bypass and ignore its own permission list — see User.js/rbac.js).
//   - PUT /:id blocks renaming or re-kind-ing an is_system role (permission
//     resolution joins roles BY NAME) but allows description-only edits.
//   - DELETE /:id blocks is_system roles and roles with active users still
//     assigned via users.group_id.
//   - PUT /:id/permissions bulk-replaces a role's permission set, blocked for
//     the admin-kind system group, and — for non-legacy-admin callers — may
//     only ADD permissions the caller themselves holds (removals are always
//     allowed).
// =============================================================================

const request = require('supertest');

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------
const mockQuery = jest.fn();
// Transactional connection used by the bulk PUT /:id/permissions replace —
// conn.execute shares the same queue as mockQuery so tests assert one SQL
// stream regardless of which API the route used.
const mockConn = {
  beginTransaction: jest.fn(),
  execute: (...args) => mockQuery(...args),
  commit: jest.fn(),
  rollback: jest.fn(),
  release: jest.fn(),
};

jest.mock('../src/config/database', () => ({
  query: mockQuery,
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(() => Promise.resolve(mockConn)),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Middleware mocks
// ---------------------------------------------------------------------------
// Mutated per-test (mutated in place, never reassigned) so the anti-
// amplification tests can flip between the legacy admin bypass and an
// ordinary roles.manage holder without re-mocking the module.
const mockUser = { id: 1, email: 'staff@test.com', role: 'admin' };

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = mockUser;
    req.userId = mockUser.id;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = 1;
    next();
  },
}));

// app.js requires this transitively for other (MX-gated) route files; not
// exercised by /roles itself, but mocked defensively so require() never
// depends on real Organization/db wiring during boot.
jest.mock('../src/middleware/orgLocale', () => ({
  requireMxLocale: (_req, _res, next) => next(),
}));

// roles.js itself calls requirePermission('roles.manage') as route-entry
// gating only — bypassed here so the tests exercise the handlers' own
// is_system / kind / anti-amplification logic instead of RBAC resolution.
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist: () => [],
}));

const app = require('../src/app');

// ---------------------------------------------------------------------------
// Fixtures — real column shapes from database/schema.sql `roles` (migration
// 378 added kind) and `permissions`.
// ---------------------------------------------------------------------------
const SYSTEM_ADMIN_ROLE = {
  id: 1,
  name: 'admin',
  description: 'Full access to all resources',
  kind: 'admin',
  is_system: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

const CUSTOM_BILLING_ROLE = {
  id: 5,
  name: 'ar_specialist',
  description: 'AR follow-up specialist',
  kind: 'billing',
  is_system: 0,
  created_at: '2026-02-01T00:00:00.000Z',
  updated_at: '2026-02-01T00:00:00.000Z',
  deleted_at: null,
};

beforeEach(() => {
  mockQuery.mockReset();
  mockUser.id = 1;
  mockUser.email = 'staff@test.com';
  mockUser.role = 'admin';
});

// ---------------------------------------------------------------------------
// POST /api/roles
// ---------------------------------------------------------------------------
describe('POST /api/roles', () => {
  test('creates a role and persists kind', async () => {
    const created = { id: 10, name: 'noc_lead', description: 'NOC shift lead', kind: 'technician', is_system: 0 };
    mockQuery
      .mockResolvedValueOnce([{ insertId: 10, affectedRows: 1 }]) // INSERT
      .mockResolvedValueOnce([[created]]);                          // SELECT

    const res = await request(app)
      .post('/api/roles')
      .send({ name: 'noc_lead', description: 'NOC shift lead', kind: 'technician' });

    expect(res.status).toBe(201);
    expect(res.body.data.kind).toBe('technician');

    const [insertSql, insertParams] = mockQuery.mock.calls[0];
    expect(insertSql).toMatch(/INSERT INTO roles/);
    expect(insertSql).toContain('kind');
    expect(insertParams).toEqual(['noc_lead', 'NOC shift lead', 'technician']);
  });

  test('rejects kind "admin" with 422 (custom groups may not bypass RBAC)', async () => {
    const res = await request(app)
      .post('/api/roles')
      .send({ name: 'sneaky_admin', description: 'x', kind: 'admin' });

    expect(res.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects a missing kind with 422', async () => {
    const res = await request(app)
      .post('/api/roles')
      .send({ name: 'no_kind', description: 'x' });

    expect(res.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PUT /api/roles/:id
// ---------------------------------------------------------------------------
describe('PUT /api/roles/:id', () => {
  test('renaming an is_system role returns 403', async () => {
    mockQuery.mockResolvedValueOnce([[SYSTEM_ADMIN_ROLE]]); // SELECT existing

    const res = await request(app).put('/api/roles/1').send({ name: 'superadmin' });

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1); // never reached the UPDATE
  });

  test('changing kind of an is_system role returns 403', async () => {
    mockQuery.mockResolvedValueOnce([[SYSTEM_ADMIN_ROLE]]);

    const res = await request(app).put('/api/roles/1').send({ kind: 'billing' });

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('description-only edit of an is_system role returns 200', async () => {
    mockQuery
      .mockResolvedValueOnce([[SYSTEM_ADMIN_ROLE]])                                  // SELECT existing
      .mockResolvedValueOnce([{ affectedRows: 1 }])                                    // UPDATE
      .mockResolvedValueOnce([[{ ...SYSTEM_ADMIN_ROLE, description: 'Updated text' }]]); // SELECT after

    const res = await request(app).put('/api/roles/1').send({ description: 'Updated text' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated text');
    expect(res.body.data.name).toBe('admin');
  });

  test('updates name and kind of a non-system (custom) role', async () => {
    const updated = { ...CUSTOM_BILLING_ROLE, name: 'ar_lead', kind: 'support' };
    mockQuery
      .mockResolvedValueOnce([[CUSTOM_BILLING_ROLE]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // UPDATE roles
      .mockResolvedValueOnce([{ affectedRows: 2 }])   // kind changed → refresh users.role mirrors
      .mockResolvedValueOnce([{ affectedRows: 2 }])   // ... and non-owner membership rows
      .mockResolvedValueOnce([[updated]]);

    const res = await request(app).put('/api/roles/5').send({ name: 'ar_lead', kind: 'support' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('ar_lead');
    expect(res.body.data.kind).toBe('support');
  });

  test('returns 404 when the role does not exist', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await request(app).put('/api/roles/999').send({ description: 'ghost' });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/roles/:id
// ---------------------------------------------------------------------------
describe('DELETE /api/roles/:id', () => {
  test('rejects deleting an is_system role with 403', async () => {
    mockQuery.mockResolvedValueOnce([[SYSTEM_ADMIN_ROLE]]);

    const res = await request(app).delete('/api/roles/1');

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('rejects deleting a role with active assigned users with 422', async () => {
    mockQuery
      .mockResolvedValueOnce([[CUSTOM_BILLING_ROLE]])   // SELECT role
      .mockResolvedValueOnce([[{ cnt: 3 }]]);             // COUNT(*) users WHERE group_id = ?

    const res = await request(app).delete('/api/roles/5');

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/reassign/i);
  });

  test('deletes an unassigned custom role and returns 204', async () => {
    mockQuery
      .mockResolvedValueOnce([[CUSTOM_BILLING_ROLE]])
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);      // soft-delete UPDATE

    const res = await request(app).delete('/api/roles/5');

    expect(res.status).toBe(204);
  });

  test('returns 404 when the role does not exist', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await request(app).delete('/api/roles/999');

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/roles/:id/permissions — bulk replace
// ---------------------------------------------------------------------------
describe('PUT /api/roles/:id/permissions', () => {
  test('happy path replaces the set and returns the full updated list', async () => {
    mockUser.role = 'admin'; // legacy bypass — skips the anti-amplification check entirely

    mockQuery
      .mockResolvedValueOnce([[CUSTOM_BILLING_ROLE]])                                     // SELECT role
      .mockResolvedValueOnce([[{ id: 1, slug: 'clients.view' }, { id: 2, slug: 'clients.create' }]]) // SELECT requested perms
      .mockResolvedValueOnce([[{ id: 3, slug: 'clients.delete' }]])                        // SELECT current perms
      .mockResolvedValueOnce([{ affectedRows: 1 }])                                        // DELETE
      .mockResolvedValueOnce([{ affectedRows: 2 }])                                        // INSERT
      .mockResolvedValueOnce([[
        { id: 1, slug: 'clients.view', description: 'View clients' },
        { id: 2, slug: 'clients.create', description: 'Create clients' },
      ]]); // SELECT final list

    const res = await request(app)
      .put('/api/roles/5/permissions')
      .send({ permission_ids: [1, 2] });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((p) => p.slug)).toEqual(['clients.view', 'clients.create']);

    const [deleteSql, deleteParams] = mockQuery.mock.calls[3];
    expect(deleteSql).toMatch(/DELETE FROM role_permissions/);
    expect(deleteParams).toEqual(['5']);
    const [insertSql, insertParams] = mockQuery.mock.calls[4];
    expect(insertSql).toMatch(/INSERT INTO role_permissions/);
    expect(insertParams).toEqual(['5', 1, '5', 2]);
  });

  test('an unknown permission id returns 422', async () => {
    mockUser.role = 'admin';

    mockQuery
      .mockResolvedValueOnce([[CUSTOM_BILLING_ROLE]]) // SELECT role
      .mockResolvedValueOnce([[]]);                     // SELECT requested perms — none match

    const res = await request(app)
      .put('/api/roles/5/permissions')
      .send({ permission_ids: [999] });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('999');
  });

  test('editing the system admin group is rejected with 403', async () => {
    mockUser.role = 'admin';
    mockQuery.mockResolvedValueOnce([[SYSTEM_ADMIN_ROLE]]); // SELECT role — kind 'admin'

    const res = await request(app)
      .put('/api/roles/1/permissions')
      .send({ permission_ids: [1] });

    expect(res.status).toBe(403);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('non-legacy-admin caller adding a slug they do not hold is rejected with 403', async () => {
    mockUser.role = 'billing'; // ordinary roles.manage holder, not the legacy bypass

    mockQuery
      .mockResolvedValueOnce([[CUSTOM_BILLING_ROLE]])                                     // SELECT role
      .mockResolvedValueOnce([[{ id: 1, slug: 'clients.view' }, { id: 2, slug: 'clients.create' }]]) // SELECT requested perms
      .mockResolvedValueOnce([[]])                                                          // SELECT current perms — none yet
      // User.getPermissions(1, 1) internals:
      .mockResolvedValueOnce([[]])                                                          // group lookup — no live group
      .mockResolvedValueOnce([[{ slug: 'clients.view' }]]);                                 // membership perms — caller only holds clients.view

    const res = await request(app)
      .put('/api/roles/5/permissions')
      .send({ permission_ids: [1, 2] });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('clients.create');
  });

  test('non-legacy-admin caller removing slugs is always allowed', async () => {
    mockUser.role = 'billing';

    mockQuery
      .mockResolvedValueOnce([[CUSTOM_BILLING_ROLE]])                  // SELECT role
      .mockResolvedValueOnce([[{ id: 1, slug: 'clients.view' }]])       // SELECT current perms — has one, being removed
      .mockResolvedValueOnce([{ affectedRows: 1 }])                     // DELETE
      .mockResolvedValueOnce([[]]);                                     // SELECT final list — empty

    const res = await request(app)
      .put('/api/roles/5/permissions')
      .send({ permission_ids: [] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    // Pure removal never needs to resolve the caller's own permissions.
    expect(mockQuery).toHaveBeenCalledTimes(4);
  });

  test('returns 404 when the role does not exist', async () => {
    mockQuery.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .put('/api/roles/999/permissions')
      .send({ permission_ids: [1] });

    expect(res.status).toBe(404);
  });

  test('rejects a non-array permission_ids with 422', async () => {
    const res = await request(app)
      .put('/api/roles/5/permissions')
      .send({ permission_ids: 'not-an-array' });

    expect(res.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
