// =============================================================================
// FireISP 5.0 — User model: permission resolution + membership sync
// =============================================================================
// Covers the fix for staff accounts created without an organization_users
// membership row: getPermissions/getOrgRole fall back to the legacy users.role,
// and create() mirrors the role into a membership row.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const User = require('../src/models/User');

beforeEach(() => jest.clearAllMocks());

describe('User.getPermissions', () => {
  test('returns the membership-resolved permissions when a membership row exists', async () => {
    // First query (organization_users path) returns rows → no fallback query.
    db.query.mockResolvedValueOnce([[{ slug: 'devices.view' }, { slug: 'work_orders.view' }]]);

    const perms = await User.getPermissions(5, 1);

    expect(perms).toEqual(['devices.view', 'work_orders.view']);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/organization_users/);
  });

  test('falls back to users.role when there is no membership row', async () => {
    // 1st call (membership path) → empty; 2nd call (users.role fallback) → perms.
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ slug: 'devices.view' }, { slug: 'clients.view' }]]);

    const perms = await User.getPermissions(5, 1);

    expect(perms).toEqual(['devices.view', 'clients.view']);
    expect(db.query).toHaveBeenCalledTimes(2);
    // The fallback query resolves via the users table + users.role.
    const fallbackSql = db.query.mock.calls[1][0];
    expect(fallbackSql).toMatch(/FROM users u/);
    expect(fallbackSql).toMatch(/r\.name = u\.role/);
    expect(db.query.mock.calls[1][1]).toEqual([5, 1]);
  });

  test('returns [] when neither a membership nor a users.role grant exists', async () => {
    db.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    const perms = await User.getPermissions(5, 1);
    expect(perms).toEqual([]);
  });
});

describe('User.getOrgRole', () => {
  test('returns the membership role when present', async () => {
    db.query.mockResolvedValueOnce([[{ role: 'technician' }]]);
    const role = await User.getOrgRole(5, 1);
    expect(role).toBe('technician');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('falls back to users.role when there is no membership row', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ role: 'technician' }]]);
    const role = await User.getOrgRole(5, 1);
    expect(role).toBe('technician');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toMatch(/FROM users/);
  });

  test('returns null when no role can be resolved', async () => {
    db.query.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    expect(await User.getOrgRole(5, 1)).toBeNull();
  });
});

describe('User.create membership sync', () => {
  test('mirrors a technician role into an organization_users membership row', async () => {
    const created = { id: 9, organization_id: 1, role: 'technician' };
    // super.create() → BaseModel insert (INSERT) then findByIdIncludingDeleted (SELECT)
    db.query
      .mockResolvedValueOnce([{ insertId: 9 }])      // INSERT INTO users
      .mockResolvedValueOnce([[created]])             // findByIdIncludingDeleted
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // INSERT IGNORE organization_users

    const user = await User.create({
      organization_id: 1, first_name: 'Jony', last_name: 'Pitt',
      email: 'jony@demo-isp.com', password_hash: 'x', role: 'technician',
    });

    expect(user).toEqual(created);
    const membershipCall = db.query.mock.calls.find(c => /organization_users/.test(c[0]));
    expect(membershipCall).toBeDefined();
    expect(membershipCall[0]).toMatch(/INSERT IGNORE INTO organization_users/);
    expect(membershipCall[1]).toEqual([1, 9, 'technician']);
  });

  test('does NOT create a membership for the legacy support role (not a valid org_users role)', async () => {
    const created = { id: 10, organization_id: 1, role: 'support' };
    db.query
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([[created]]);

    await User.create({
      organization_id: 1, first_name: 'Sam', last_name: 'Sup',
      email: 'sam@demo-isp.com', password_hash: 'x', role: 'support',
    });

    const membershipCall = db.query.mock.calls.find(c => /organization_users/.test(c[0]));
    expect(membershipCall).toBeUndefined();
  });

  test('syncOrgMembership is a no-op without an org or role', async () => {
    await User.syncOrgMembership({ id: 1 });
    await User.syncOrgMembership({ id: 1, organization_id: 1 });
    await User.syncOrgMembership(null);
    expect(db.query).not.toHaveBeenCalled();
  });
});
