'use strict';

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn((callback) => callback()),
}));

const db = require('../src/config/database');
const User = require('../src/models/User');

describe('organization Users-page visibility', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists home users, explicit members, install operators, and exact system super admins', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, has_global_organization_access: 1 },
      { id: 9, has_global_organization_access: 0 },
    ]]);

    const rows = await User.findAll({
      orgId: 7,
      where: { status: 'active' },
      orderBy: 'email',
      order: 'DESC',
      limit: 25,
      offset: 50,
    });

    expect(rows).toHaveLength(2);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/u\.organization_id = \?/);
    expect(sql).toMatch(/FROM organization_users visible_membership/);
    expect(sql).toMatch(/visible_membership\.organization_id = \?/);
    expect(sql).toMatch(/u\.is_install_operator = TRUE/);
    expect(sql).toMatch(/global_role\.name = 'super_admin'/);
    expect(sql).toMatch(/global_role\.is_system = TRUE/);
    expect(sql).toMatch(/AS has_global_organization_access/);
    expect(sql).not.toMatch(/u\.role = 'admin'/);
    expect(sql).toMatch(/u\..*status.* = \?/);
    expect(sql).toMatch(/ORDER BY u\..*email.* DESC/);
    expect(sql).toMatch(/LIMIT 25 OFFSET 50/);
    expect(params).toEqual([7, 7, 'active']);
    expect(db.withPrimaryContext).toHaveBeenCalledTimes(1);
  });

  test('count uses the exact same organization/global visibility boundary', async () => {
    db.query.mockResolvedValueOnce([[{ total: 4 }]]);

    await expect(User.count({ orgId: 12, where: { group_id: 3 } })).resolves.toBe(4);

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toMatch(/FROM organization_users visible_membership/);
    expect(sql).toMatch(/u\.is_install_operator = TRUE/);
    expect(sql).toMatch(/global_role\.name = 'super_admin'/);
    expect(sql).toMatch(/u\..*group_id.* = \?/);
    expect(params).toEqual([12, 12, 3]);
  });

  test('archived accounts remain visible only in their home organization', async () => {
    db.query.mockResolvedValueOnce([[{ id: 22, deleted_at: '2026-08-22' }]]);

    await User.findAll({ orgId: 5, onlyDeleted: true });

    const [sql, params] = db.query.mock.calls[0];
    const whereSql = sql.slice(sql.lastIndexOf('WHERE'));
    expect(whereSql).toMatch(/u\.organization_id = \?/);
    expect(whereSql).not.toMatch(/FROM organization_users visible_membership/);
    expect(whereSql).toMatch(/u\.deleted_at IS NOT NULL/);
    expect(params).toEqual([5]);
  });

  test('ignores unapproved filter and sort column names', async () => {
    db.query.mockResolvedValueOnce([[]]);

    await User.findAll({
      orgId: 2,
      where: { 'email) OR TRUE --': 'x' },
      orderBy: 'email DESC; DROP TABLE users',
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain('OR TRUE --');
    expect(sql).toMatch(/ORDER BY u\..*id.* ASC/);
    expect(params).toEqual([2, 2]);
  });
});
