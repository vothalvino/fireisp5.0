// =============================================================================
// FireISP 5.0 — Staff-account archiving
// =============================================================================
// "Deleting" a staff user is ARCHIVING: soft-delete + forced status='inactive'
// in one statement, so a later restore never revives a login-able account.
// The Users page's Archived tab lists archived rows via ?only_deleted=true
// (BaseModel findAll/count onlyDeleted).
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// App-level mocks for the PATCH /users/:id/group endpoint tests. mockUser is
// mutated in place so restrictRoleAssignment can be exercised for non-admins.
const mockUser = { id: 1, email: 'admin@test.com', role: 'admin' };
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = mockUser; req.userId = mockUser.id; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/orgLocale', () => ({
  requireMxLocale: (_req, _res, next) => next(),
}));
jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist: () => [],
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const request = require('supertest');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

beforeEach(() => jest.clearAllMocks());

describe('User.delete (archive)', () => {
  test('soft-deletes AND forces status inactive in a single statement', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(User.delete(9, 1)).resolves.toBe(true);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/SET deleted_at = NOW\(\), status = 'inactive'/);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/organization_id = \?/);
    expect(params).toEqual([9, 1]);
  });

  test('throws NotFound when the user is already archived or missing', async () => {
    db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(User.delete(9, 1)).rejects.toThrow(/users/);
  });
});

describe('BaseModel onlyDeleted (Archived tab listing)', () => {
  test('findAll with onlyDeleted filters to deleted_at IS NOT NULL', async () => {
    db.query.mockResolvedValueOnce([[{ id: 9 }]]);

    await User.findAll({ orgId: 1, onlyDeleted: true });

    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NOT NULL/);
    expect(sql).not.toMatch(/deleted_at IS NULL/);
  });

  test('count with onlyDeleted filters to deleted_at IS NOT NULL', async () => {
    db.query.mockResolvedValueOnce([[{ total: 3 }]]);

    const total = await User.count({ orgId: 1, onlyDeleted: true });

    expect(total).toBe(3);
    expect(db.query.mock.calls[0][0]).toMatch(/deleted_at IS NOT NULL/);
  });

  test('onlyDeleted wins over withDeleted', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await User.findAll({ orgId: 1, onlyDeleted: true, withDeleted: true });
    expect(db.query.mock.calls[0][0]).toMatch(/deleted_at IS NOT NULL/);
  });

  test('default listing still excludes archived rows', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await User.findAll({ orgId: 1 });
    expect(db.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
  });

  test('onlyDeleted on a hard-delete model returns an empty archive, not live rows', async () => {
    const BaseModel = require('../src/models/BaseModel');
    class HardDeleteModel extends BaseModel {
      static get tableName() { return 'hard_things'; }
      static get fillable() { return ['name']; }
      static get softDelete() { return false; }
      static get hasOrgScope() { return false; }
    }
    expect(await HardDeleteModel.findAll({ onlyDeleted: true })).toEqual([]);
    expect(await HardDeleteModel.count({ onlyDeleted: true })).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('PATCH /users/:id/group — reassign an archived user without restoring', () => {
  const ARCHIVED = { id: 9, organization_id: 1, role: 'billing', group_id: 2, status: 'inactive', deleted_at: '2026-07-12 10:00:00' };
  const ACTIVE = { ...ARCHIVED, deleted_at: null };

  beforeEach(() => { mockUser.role = 'admin'; });

  test('changes group + role mirror and refreshes membership rows for an archived user', async () => {
    db.query
      .mockResolvedValueOnce([[ARCHIVED]])                               // findByIdIncludingDeleted
      .mockResolvedValueOnce([[{ id: 4, name: 'technician', kind: 'technician' }]]) // resolveGroupMirror
      .mockResolvedValueOnce([{ affectedRows: 1 }])                      // UPDATE users (archived-only, affectedRows checked)
      .mockResolvedValueOnce([{ affectedRows: 1 }])                      // refreshMembershipRoles
      .mockResolvedValueOnce([[{ ...ARCHIVED, group_id: 4, role: 'technician' }]]); // final fetch

    const res = await request(app).patch('/api/v1/users/9/group').send({ group_id: 4 });

    expect(res.status).toBe(200);
    expect(res.body.data.group_id).toBe(4);
    expect(res.body.data.role).toBe('technician');
    const updateCall = db.query.mock.calls[2];
    expect(updateCall[0]).toMatch(/UPDATE users SET group_id = \?, role = \? WHERE id = \? AND deleted_at IS NOT NULL/);
    expect(updateCall[1]).toEqual([4, 'technician', 9]);
    const membershipCall = db.query.mock.calls[3];
    expect(membershipCall[0]).toMatch(/UPDATE organization_users SET role/);
  });

  test('404s when the row stopped being archived between check and write (concurrent restore)', async () => {
    db.query
      .mockResolvedValueOnce([[ARCHIVED]])                               // findByIdIncludingDeleted (still archived)
      .mockResolvedValueOnce([[{ id: 4, name: 'technician', kind: 'technician' }]]) // resolveGroupMirror
      .mockResolvedValueOnce([{ affectedRows: 0 }]);                     // UPDATE ... AND deleted_at IS NOT NULL → restored mid-flight
    const res = await request(app).patch('/api/v1/users/9/group').send({ group_id: 4 });
    expect(res.status).toBe(404);
  });

  test('422s for an ACTIVE user — live accounts use the normal edit with its guards', async () => {
    db.query.mockResolvedValueOnce([[ACTIVE]]);
    const res = await request(app).patch('/api/v1/users/9/group').send({ group_id: 4 });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/ARCHIVED users only/);
  });

  test('404s when the user does not exist', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const res = await request(app).patch('/api/v1/users/999/group').send({ group_id: 4 });
    expect(res.status).toBe(404);
  });

  test('422s for an unknown group id', async () => {
    db.query
      .mockResolvedValueOnce([[ARCHIVED]])
      .mockResolvedValueOnce([[]]); // resolveGroupMirror: no such group
    const res = await request(app).patch('/api/v1/users/9/group').send({ group_id: 999 });
    expect(res.status).toBe(422);
  });

  test('403s for a non-admin caller (restrictRoleAssignment covers group_id)', async () => {
    mockUser.role = 'billing';
    const res = await request(app).patch('/api/v1/users/9/group').send({ group_id: 4 });
    expect(res.status).toBe(403);
  });
});
