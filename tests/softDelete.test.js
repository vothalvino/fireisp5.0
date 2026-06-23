// =============================================================================
// FireISP 5.0 — Soft-Delete Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/auditLog', () => ({
  log: jest.fn(),
}));

const db = require('../src/config/database');
const auditLog = require('../src/services/auditLog');
const BaseModel = require('../src/models/BaseModel');
const { crudController } = require('../src/controllers/crudController');

// Soft-delete model
class SoftModel extends BaseModel {
  static get tableName() { return 'soft_things'; }
  static get fillable() { return ['name', 'status', 'organization_id']; }
  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

// Hard-delete model (no softDelete override)
class HardModel extends BaseModel {
  static get tableName() { return 'hard_things'; }
  static get fillable() { return ['name', 'status', 'organization_id']; }
  static get hasOrgScope() { return true; }
}

describe('Soft-Delete BaseModel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // softDelete flag
  // ===========================================================================
  test('SoftModel has softDelete = true', () => {
    expect(SoftModel.softDelete).toBe(true);
  });

  test('HardModel has softDelete = false (default)', () => {
    expect(HardModel.softDelete).toBe(false);
  });

  // ===========================================================================
  // findById — filters soft-deleted records
  // ===========================================================================
  test('findById excludes soft-deleted records for SoftModel', async () => {
    db.query.mockResolvedValue([[{ id: 1, name: 'Test' }]]);
    await SoftModel.findById(1, 42);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('AND deleted_at IS NULL'),
      [1, 42],
    );
  });

  test('findById does NOT filter deleted_at for HardModel', async () => {
    db.query.mockResolvedValue([[{ id: 1, name: 'Test' }]]);
    await HardModel.findById(1, 42);
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('deleted_at'),
      [1, 42],
    );
  });

  // ===========================================================================
  // findByIdIncludingDeleted — ignores soft-delete filter
  // ===========================================================================
  test('findByIdIncludingDeleted returns soft-deleted records', async () => {
    db.query.mockResolvedValue([[{ id: 1, name: 'Deleted', deleted_at: '2025-01-01' }]]);
    const result = await SoftModel.findByIdIncludingDeleted(1, 42);
    expect(result).toEqual({ id: 1, name: 'Deleted', deleted_at: '2025-01-01' });
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('deleted_at IS NULL'),
      [1, 42],
    );
  });

  // ===========================================================================
  // findAll — filters soft-deleted records by default
  // ===========================================================================
  test('findAll excludes soft-deleted for SoftModel', async () => {
    db.query.mockResolvedValue([[{ id: 1 }]]);
    await SoftModel.findAll({ orgId: 42 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('deleted_at IS NULL'),
      expect.any(Array),
    );
  });

  test('findAll includes deleted records when withDeleted = true', async () => {
    db.query.mockResolvedValue([[{ id: 1 }, { id: 2, deleted_at: '2025-01-01' }]]);
    await SoftModel.findAll({ orgId: 42, withDeleted: true });
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('deleted_at IS NULL'),
      expect.any(Array),
    );
  });

  test('findAll does NOT filter deleted_at for HardModel', async () => {
    db.query.mockResolvedValue([[{ id: 1 }]]);
    await HardModel.findAll({ orgId: 42 });
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('deleted_at'),
      expect.any(Array),
    );
  });

  // ===========================================================================
  // count — filters soft-deleted records by default
  // ===========================================================================
  test('count excludes soft-deleted for SoftModel', async () => {
    db.query.mockResolvedValue([[{ total: 5 }]]);
    await SoftModel.count({ orgId: 42 });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('deleted_at IS NULL'),
      expect.any(Array),
    );
  });

  test('count includes deleted records when withDeleted = true', async () => {
    db.query.mockResolvedValue([[{ total: 10 }]]);
    await SoftModel.count({ orgId: 42, withDeleted: true });
    expect(db.query).toHaveBeenCalledWith(
      expect.not.stringContaining('deleted_at IS NULL'),
      expect.any(Array),
    );
  });

  // ===========================================================================
  // delete — soft-deletes via UPDATE for SoftModel
  // ===========================================================================
  test('delete sets deleted_at for SoftModel', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await SoftModel.delete(1, 42);
    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE'),
      expect.any(Array),
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SET deleted_at = NOW()'),
      expect.any(Array),
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('AND deleted_at IS NULL'),
      expect.any(Array),
    );
  });

  test('delete performs hard DELETE for HardModel', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    await HardModel.delete(1, 42);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM'),
      expect.any(Array),
    );
  });

  test('delete throws NotFoundError for already-deleted SoftModel record', async () => {
    db.query.mockResolvedValue([{ affectedRows: 0 }]);
    await expect(SoftModel.delete(999, 42)).rejects.toThrow('not found');
  });

  // ===========================================================================
  // forceDelete — always performs hard DELETE
  // ===========================================================================
  test('forceDelete performs hard DELETE for SoftModel', async () => {
    db.query.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await SoftModel.forceDelete(1, 42);
    expect(result).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM'),
      [1, 42],
    );
  });

  test('forceDelete throws NotFoundError when record missing', async () => {
    db.query.mockResolvedValue([{ affectedRows: 0 }]);
    await expect(SoftModel.forceDelete(999, 42)).rejects.toThrow('not found');
  });

  // ===========================================================================
  // restore — clears deleted_at
  // ===========================================================================
  test('restore clears deleted_at and returns record', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE SET deleted_at = NULL
      .mockResolvedValueOnce([[{ id: 1, name: 'Restored', deleted_at: null }]]);  // findById

    const result = await SoftModel.restore(1, 42);
    expect(result).toEqual({ id: 1, name: 'Restored', deleted_at: null });
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('SET deleted_at = NULL'),
      expect.any(Array),
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('AND deleted_at IS NOT NULL'),
      expect.any(Array),
    );
  });

  test('restore throws NotFoundError for non-deleted record', async () => {
    db.query.mockResolvedValue([{ affectedRows: 0 }]);
    await expect(SoftModel.restore(999, 42)).rejects.toThrow('not found');
  });

  test('restore throws Error for HardModel', async () => {
    await expect(HardModel.restore(1, 42)).rejects.toThrow('does not support soft-delete');
  });

  // ===========================================================================
  // update — filters soft-deleted records
  // ===========================================================================
  test('update excludes soft-deleted records for SoftModel', async () => {
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
      .mockResolvedValueOnce([[{ id: 1, name: 'Updated' }]]);  // findById

    await SoftModel.update(1, { name: 'Updated' }, 42);
    const updateCall = db.query.mock.calls[0];
    expect(updateCall[0]).toContain('AND deleted_at IS NULL');
  });
});

// =============================================================================
// Soft-Delete crudController Tests
// =============================================================================

describe('crudController soft-delete', () => {
  const ctrl = crudController(SoftModel);

  function mockReqRes(overrides = {}) {
    const req = {
      params: { id: '1' },
      query: { page: '1', limit: '10' },
      body: {},
      orgId: 42,
      user: { id: 5 },
      ...overrides,
    };
    const res = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();
    return { req, res, next };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    auditLog.log.mockResolvedValue();
  });

  // ===========================================================================
  // destroy — logs soft_delete action
  // ===========================================================================
  test('destroy logs soft_delete audit action for soft-delete model', async () => {
    const record = { id: 1, name: 'Test', organization_id: 42 };
    db.query
      .mockResolvedValueOnce([[record]])  // findByIdOrFail
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // soft-delete UPDATE

    const { req, res, next } = mockReqRes();
    await ctrl.destroy(req, res, next);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'soft_delete',
      tableName: 'soft_things',
    }));
  });

  test('destroy logs delete action for hard-delete model', async () => {
    const hardCtrl = crudController(HardModel);
    const record = { id: 1, name: 'Test', organization_id: 42 };
    db.query
      .mockResolvedValueOnce([[record]])  // findByIdOrFail
      .mockResolvedValueOnce([{ affectedRows: 1 }]);  // hard DELETE

    const { req, res, next } = mockReqRes();
    await hardCtrl.destroy(req, res, next);

    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delete',
    }));
  });

  // ===========================================================================
  // restore — restores soft-deleted records
  // ===========================================================================
  test('restore returns 200 with restored record', async () => {
    const restored = { id: 1, name: 'Test', deleted_at: null };
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE SET deleted_at = NULL
      .mockResolvedValueOnce([[restored]]);  // findById

    const { req, res, next } = mockReqRes();
    await ctrl.restore(req, res, next);

    expect(res.json).toHaveBeenCalledWith({ data: restored });
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'restore',
      tableName: 'soft_things',
      recordId: 1,
    }));
  });

  test('restore calls next on error', async () => {
    db.query.mockResolvedValue([{ affectedRows: 0 }]);

    const { req, res, next } = mockReqRes({ params: { id: '999' } });
    await ctrl.restore(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 404,
    }));
  });

  // ===========================================================================
  // list — supports include_deleted query param
  // ===========================================================================
  test('list includes deleted records when include_deleted=true', async () => {
    const rows = [{ id: 1 }, { id: 2, deleted_at: '2025-01-01' }];
    db.query
      .mockResolvedValueOnce([rows])
      .mockResolvedValueOnce([[{ total: 2 }]]);

    const { req, res, next } = mockReqRes({
      query: { page: '1', limit: '10', include_deleted: 'true' },
    });
    await ctrl.list(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: rows,
    }));
    // Verify that the queries were called with withDeleted = true
    // (they won't contain 'deleted_at IS NULL' filter)
    const findAllCall = db.query.mock.calls[0];
    expect(findAllCall[0]).not.toContain('deleted_at IS NULL');
  });
});

// =============================================================================
// Verify real models have softDelete enabled
// =============================================================================

describe('Resource models have softDelete = true', () => {
  const modelFiles = [
    'Client', 'Invoice', 'Device', 'User', 'Ticket', 'Contract', 'Plan',
    'Payment', 'Organization', 'Site', 'Nas', 'Radius', 'Expense',
    'Webhook', 'Role', 'ApiToken', 'CoverageZone', 'ServiceArea',
  ];

  modelFiles.forEach((modelName) => {
    test(`${modelName} has softDelete = true`, () => {
      const Model = require(`../src/models/${modelName}`);
      expect(Model.softDelete).toBe(true);
    });
  });
});

describe('System models have softDelete = false', () => {
  const modelFiles = [
    'AuditLog', 'ConnectionLog', 'EmailLog', 'SmsLog', 'Permission',
    'ScheduledTask', 'Setting', 'UserSession',
  ];

  modelFiles.forEach((modelName) => {
    test(`${modelName} has softDelete = false`, () => {
      const Model = require(`../src/models/${modelName}`);
      expect(Model.softDelete).toBe(false);
    });
  });
});
