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
  getConnection: jest.fn(),
}));

const db = require('../src/config/database');
const User = require('../src/models/User');

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
