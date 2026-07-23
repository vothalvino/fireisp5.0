// =============================================================================
// FireISP 5.0 — BaseModel Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const BaseModel = require('../src/models/BaseModel');

// Create a concrete subclass for testing
class TestModel extends BaseModel {
  static get tableName() { return 'test_table'; }
  static get fillable() { return ['name', 'email', 'status']; }
  static get hasOrgScope() { return true; }
  // A service-managed column that must be filterable but never writable.
  static get filterableColumns() { return ['lifecycle_state']; }
}

describe('BaseModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('tableName throws if not overridden', () => {
    expect(() => BaseModel.tableName).toThrow('Subclass must define tableName');
  });

  test('findById queries by ID', async () => {
    db.query.mockResolvedValue([[{ id: 1, name: 'Test' }]]);
    const result = await TestModel.findById(1);
    expect(result).toEqual({ id: 1, name: 'Test' });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = ?'),
      [1],
    );
  });

  test('findById with orgScope adds organization filter', async () => {
    db.query.mockResolvedValue([[{ id: 1, name: 'Test' }]]);
    await TestModel.findById(1, 42);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('AND organization_id = ?'),
      [1, 42],
    );
  });

  test('findById returns null when not found', async () => {
    db.query.mockResolvedValue([[]]);
    const result = await TestModel.findById(999);
    expect(result).toBeNull();
  });

  test('findAll filters by a filterableColumns value (non-fillable but whitelisted)', async () => {
    db.query.mockResolvedValue([[]]);
    await TestModel.findAll({ where: { lifecycle_state: 'active' } });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('`lifecycle_state` = ?');
    expect(params).toContain('active');
  });

  test('findAll IGNORES a where column that is neither fillable nor filterable', async () => {
    db.query.mockResolvedValue([[]]);
    await TestModel.findAll({ where: { not_a_real_filter: 'x' } });
    const [sql] = db.query.mock.calls[0];
    expect(sql).not.toContain('not_a_real_filter');
  });

  test('BaseModel.filterableColumns defaults to empty', () => {
    expect(BaseModel.filterableColumns).toEqual([]);
  });

  test('findByIdOrFail throws NotFoundError', async () => {
    db.query.mockResolvedValue([[]]);
    await expect(TestModel.findByIdOrFail(999)).rejects.toThrow('not found');
  });

  test('create filters to fillable columns', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])  // INSERT
      .mockResolvedValueOnce([[{ id: 1, name: 'New' }]]);  // findById

    await TestModel.create({ name: 'New', email: 'a@b.com', secret_field: 'hack' });

    const insertCall = db.query.mock.calls[0];
    expect(insertCall[0]).not.toContain('secret_field');
    expect(insertCall[0]).toContain('name');
    expect(insertCall[0]).toContain('email');
  });

  test('create throws on empty data', async () => {
    await expect(TestModel.create({ secret_field: 'hack' })).rejects.toThrow('No fillable data');
  });

  test('update filters to fillable columns', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
      .mockResolvedValueOnce([[{ id: 1, name: 'Updated' }]]);  // findById

    await TestModel.update(1, { name: 'Updated', secret_field: 'hack' });

    const updateCall = db.query.mock.calls[0];
    expect(updateCall[0]).not.toContain('secret_field');
    expect(updateCall[0]).toContain('name');
  });

  test('delete removes record', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await TestModel.delete(1);
    expect(result).toBe(true);
  });

  test('delete throws when record not found', async () => {
    db.query.mockResolvedValue([{ affectedRows: 0 }]);
    await expect(TestModel.delete(999)).rejects.toThrow('not found');
  });

  test('count returns total', async () => {
    db.query.mockResolvedValue([[{ total: 42 }]]);
    const result = await TestModel.count({ orgId: 1 });
    expect(result).toBe(42);
  });

  test('findAll with pagination', async () => {
    db.query.mockResolvedValue([[{ id: 1 }, { id: 2 }]]);
    const result = await TestModel.findAll({ limit: 10, offset: 0, orgId: 1 });
    expect(result).toHaveLength(2);
  });
});
