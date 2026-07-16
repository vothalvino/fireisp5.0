// =============================================================================
// FireISP 5.0 — User model: permission resolution + membership sync
// =============================================================================
// Migration 378 makes users.group_id the authoritative permission source:
//   1. live group + org access → the group's permission set (EVEN when empty —
//      an empty custom group must not fall through to legacy grants);
//   2. else organization_users membership role (pre-378 path);
//   3. else legacy users.role, only for users homed in the org.
// create() resolves the group_id ↔ users.role mirror and syncs a membership.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const User = require('../src/models/User');

beforeEach(() => jest.clearAllMocks());

describe('User.getPermissions — group path (migration 378)', () => {
  test('returns the group permission set when the user has a live group and org access', async () => {
    db.query
      .mockResolvedValueOnce([[{ group_id: 7, has_access: 1 }]])     // group resolve
      .mockResolvedValueOnce([[{ slug: 'quotes.view' }, { slug: 'quotes.create' }]]);

    const perms = await User.getPermissions(5, 1);

    expect(perms).toEqual(['quotes.view', 'quotes.create']);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0][0]).toMatch(/g\.id = u\.group_id/);
    expect(db.query.mock.calls[1][1]).toEqual([7]);
  });

  test('an EMPTY group is authoritative — returns [] without falling back to legacy grants', async () => {
    db.query
      .mockResolvedValueOnce([[{ group_id: 7, has_access: 1 }]])
      .mockResolvedValueOnce([[]]);                                   // group grants nothing

    const perms = await User.getPermissions(5, 1);

    expect(perms).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(2);                        // no fallback queries
  });

  test('a live group WITHOUT org access falls through and resolves nothing', async () => {
    db.query
      .mockResolvedValueOnce([[{ group_id: 7, has_access: 0 }]])      // no home/membership
      .mockResolvedValueOnce([[]])                                    // membership path
      .mockResolvedValueOnce([[]]);                                   // legacy fallback

    expect(await User.getPermissions(5, 1)).toEqual([]);
    expect(db.query).toHaveBeenCalledTimes(3);
  });
});

describe('User.getPermissions — legacy paths (no live group)', () => {
  test('returns the membership-resolved permissions when a membership row exists', async () => {
    db.query
      .mockResolvedValueOnce([[]])                                    // no live group
      .mockResolvedValueOnce([[{ slug: 'devices.view' }, { slug: 'work_orders.view' }]]);

    const perms = await User.getPermissions(5, 1);

    expect(perms).toEqual(['devices.view', 'work_orders.view']);
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[1][0]).toMatch(/organization_users/);
  });

  test('falls back to users.role when there is no membership row', async () => {
    db.query
      .mockResolvedValueOnce([[]])                                    // no live group
      .mockResolvedValueOnce([[]])                                    // membership path empty
      .mockResolvedValueOnce([[{ slug: 'devices.view' }, { slug: 'clients.view' }]]);

    const perms = await User.getPermissions(5, 1);

    expect(perms).toEqual(['devices.view', 'clients.view']);
    expect(db.query).toHaveBeenCalledTimes(3);
    const fallbackSql = db.query.mock.calls[2][0];
    expect(fallbackSql).toMatch(/FROM users u/);
    expect(fallbackSql).toMatch(/r\.name = u\.role/);
    expect(db.query.mock.calls[2][1]).toEqual([5, 1]);
  });

  test('returns [] when neither a membership nor a users.role grant exists', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    expect(await User.getPermissions(5, 1)).toEqual([]);
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

// Migration 400 — used by notificationHooks.resolveStaffRecipients() so bell/
// email fan-out resolves recipients the RBAC-authoritative way (organization_users
// membership role for the target org, falling back to legacy users.role only
// for users homed here with no membership row) instead of querying users.role
// directly, which silently excluded anyone whose real access came from a
// membership row alone.
describe('User.getStaffByEffectiveRole', () => {
  test("bind contract: requesting 'admin' expands the MEMBERSHIP branch to include 'owner' (never the legacy branch)", async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, email: 'a@demo-isp.com', first_name: 'A' }]]);
    const rows = await User.getStaffByEffectiveRole(1, ['admin', 'technician']);

    expect(rows).toEqual([{ id: 1, email: 'a@demo-isp.com', first_name: 'A' }]);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN organization_users ou/);
    expect(sql).toMatch(/ou\.id IS NOT NULL AND ou\.role IN/);
    expect(sql).toMatch(/ou\.id IS NULL AND u\.organization_id = \? AND u\.role IN/);
    expect(sql).not.toMatch(/email IS NOT NULL/); // deliberate — see resolveStaffRecipients
    // membership branch: ['admin', 'technician', 'owner'] (expanded);
    // legacy branch: ['admin', 'technician'] (UN-expanded — 'owner' is not a
    // valid users.role value, so expanding it there would be a no-op at best).
    expect(params).toEqual([1, 'admin', 'technician', 'owner', 1, 'admin', 'technician']);
  });

  test("does NOT expand 'owner' when 'admin' is not requested", async () => {
    db.query.mockResolvedValueOnce([[]]);
    await User.getStaffByEffectiveRole(1, ['technician']);
    const [, params] = db.query.mock.calls[0];
    expect(params).toEqual([1, 'technician', 1, 'technician']);
  });

  test('does not filter out staff with a NULL email — the caller decides whether to skip the email leg', async () => {
    db.query.mockResolvedValueOnce([[{ id: 4, email: null, first_name: 'Dana' }]]);
    const rows = await User.getStaffByEffectiveRole(1, ['admin']);
    expect(rows).toEqual([{ id: 4, email: null, first_name: 'Dana' }]);
  });
});

describe('User.resolveGroupMirror', () => {
  test('group_id forces role to the group kind', async () => {
    db.query.mockResolvedValueOnce([[{ id: 7, name: 'NOC Night Shift', kind: 'technician' }]]);
    const data = { group_id: 7, role: 'admin' };
    await User.resolveGroupMirror(data);
    expect(data.role).toBe('technician');
  });

  test('rejects a missing or deleted group', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await expect(User.resolveGroupMirror({ group_id: 99 }))
      .rejects.toThrow(/does not reference an existing user group/);
  });

  test('rejects a group without a kind', async () => {
    db.query.mockResolvedValueOnce([[{ id: 7, name: 'Legacy Custom', kind: null }]]);
    await expect(User.resolveGroupMirror({ group_id: 7 }))
      .rejects.toThrow(/has no kind/);
  });

  test('role-only input resolves group_id from the same-named system group', async () => {
    db.query.mockResolvedValueOnce([[{ id: 3 }]]);
    const data = { role: 'billing' };
    await User.resolveGroupMirror(data);
    expect(data.group_id).toBe(3);
    expect(db.query.mock.calls[0][1]).toEqual(['billing']);
  });
});

describe('User.create membership sync', () => {
  test('mirrors a technician role into an organization_users membership row', async () => {
    const created = { id: 9, organization_id: 1, role: 'technician' };
    db.query
      .mockResolvedValueOnce([[{ id: 4 }]])           // resolveGroupMirror: role → system group
      .mockResolvedValueOnce([{ insertId: 9 }])       // INSERT INTO users
      .mockResolvedValueOnce([[created]])              // findByIdIncludingDeleted
      .mockResolvedValueOnce([{ affectedRows: 1 }]);   // INSERT IGNORE organization_users

    const user = await User.create({
      organization_id: 1, first_name: 'Jony', last_name: 'Pitt',
      email: 'jony@demo-isp.com', password_hash: 'x', role: 'technician',
    });

    expect(user).toEqual(created);
    const membershipCall = db.query.mock.calls.find(c => /INSERT IGNORE INTO organization_users/.test(c[0]));
    expect(membershipCall).toBeDefined();
    expect(membershipCall[1]).toEqual([1, 9, 'technician']);
  });

  test('creates a membership for the support role (valid org_users role since 378)', async () => {
    const created = { id: 10, organization_id: 1, role: 'support' };
    db.query
      .mockResolvedValueOnce([[{ id: 5 }]])           // resolveGroupMirror
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([[created]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await User.create({
      organization_id: 1, first_name: 'Sam', last_name: 'Sup',
      email: 'sam@demo-isp.com', password_hash: 'x', role: 'support',
    });

    const membershipCall = db.query.mock.calls.find(c => /INSERT IGNORE INTO organization_users/.test(c[0]));
    expect(membershipCall).toBeDefined();
    expect(membershipCall[1]).toEqual([1, 10, 'support']);
  });

  test('syncOrgMembership is a no-op without an org or role', async () => {
    await User.syncOrgMembership({ id: 1 });
    await User.syncOrgMembership({ id: 1, organization_id: 1 });
    await User.syncOrgMembership(null);
    expect(db.query).not.toHaveBeenCalled();
  });
});

describe('User.setUserOrganizations', () => {
  test('upserts each target org, soft-deletes deselected non-owner rows, repoints home org', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // upsert org 2
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // upsert org 3
      .mockResolvedValueOnce([{ affectedRows: 1 }])   // soft-delete others
      .mockResolvedValueOnce([[{ organization_id: 1 }]]) // home org lookup (deselected)
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // repoint home
    await User.setUserOrganizations(9, [2, 3], 'billing');

    expect(db.query.mock.calls[0][0]).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(db.query.mock.calls[0][1]).toEqual([2, 9, 'billing']);
    expect(db.query.mock.calls[2][0]).toMatch(/role != 'owner'/);
    expect(db.query.mock.calls[4][0]).toMatch(/UPDATE users SET organization_id/);
    expect(db.query.mock.calls[4][1]).toEqual([2, 9]);
  });

  test('rejects an empty organization list', async () => {
    await expect(User.setUserOrganizations(9, [], 'billing'))
      .rejects.toThrow(/at least one organization/);
  });
});
