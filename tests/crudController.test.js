// =============================================================================
// FireISP 5.0 — CRUD Controller Unit Tests
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

// Test model
class TestEntity extends BaseModel {
  static get tableName() { return 'test_entities'; }
  static get fillable() { return ['name', 'status', 'organization_id']; }
  static get hasOrgScope() { return true; }
}

describe('crudController', () => {
  const ctrl = crudController(TestEntity);

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

  // =========================================================================
  // list
  // =========================================================================
  describe('list', () => {
    test('returns paginated results', async () => {
      const rows = [{ id: 1, name: 'Test' }, { id: 2, name: 'Test 2' }];
      db.query
        .mockResolvedValueOnce([rows])  // findAll
        .mockResolvedValueOnce([[{ total: 25 }]]);  // count

      const { req, res, next } = mockReqRes({ query: { page: '2', limit: '10' } });
      await ctrl.list(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        data: rows,
        meta: expect.objectContaining({
          total: 25,
          page: 2,
          limit: 10,
          totalPages: 3,
        }),
      });
    });

    test('defaults to page 1 and limit 50', async () => {
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const { req, res, next } = mockReqRes({ query: {} });
      await ctrl.list(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        meta: expect.objectContaining({ page: 1, limit: 50 }),
      }));
    });

    test('caps limit at 100', async () => {
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const { req, res, next } = mockReqRes({ query: { limit: '500' } });
      await ctrl.list(req, res, next);

      // Verify the query used limit 100, not 500
      const findAllCall = db.query.mock.calls[0];
      expect(findAllCall[1]).toContain(100);
    });

    test('calls next on error', async () => {
      db.query.mockRejectedValueOnce(new Error('DB error'));

      const { req, res, next } = mockReqRes();
      await ctrl.list(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // =========================================================================
  // get
  // =========================================================================
  describe('get', () => {
    test('returns single record by ID', async () => {
      const record = { id: 1, name: 'Test', organization_id: 42 };
      db.query.mockResolvedValueOnce([[record]]);

      const { req, res, next } = mockReqRes();
      await ctrl.get(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ data: record });
    });

    test('returns 404 when record not found', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const { req, res, next } = mockReqRes({ params: { id: '999' } });
      await ctrl.get(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 404,
      }));
    });
  });

  // =========================================================================
  // create
  // =========================================================================
  describe('create', () => {
    test('creates record and returns 201', async () => {
      const created = { id: 10, name: 'New', status: 'active', organization_id: 42 };
      db.query
        .mockResolvedValueOnce([{ insertId: 10 }])  // INSERT
        .mockResolvedValueOnce([[created]]);  // findById

      const { req, res, next } = mockReqRes({
        body: { name: 'New', status: 'active' },
      });
      await ctrl.create(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ data: created });
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'create',
        tableName: 'test_entities',
        recordId: 10,
      }));
    });

    test('auto-injects organization_id', async () => {
      db.query
        .mockResolvedValueOnce([{ insertId: 11 }])
        .mockResolvedValueOnce([[{ id: 11 }]]);

      const { req, res, next } = mockReqRes({ body: { name: 'Test' } });
      await ctrl.create(req, res, next);

      // The body should have organization_id injected
      expect(req.body.organization_id).toBe(42);
    });
  });

  // =========================================================================
  // update
  // =========================================================================
  describe('update', () => {
    test('updates record and returns it', async () => {
      const old = { id: 1, name: 'Old', organization_id: 42 };
      const updated = { id: 1, name: 'Updated', organization_id: 42 };

      db.query
        .mockResolvedValueOnce([[old]])  // findByIdOrFail (old)
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
        .mockResolvedValueOnce([[updated]]);  // findById (updated)

      const { req, res, next } = mockReqRes({ body: { name: 'Updated' } });
      await ctrl.update(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ data: updated });
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'update',
        oldValues: old,
      }));
    });

    test('returns 404 when record not found', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const { req, res, next } = mockReqRes({
        params: { id: '999' },
        body: { name: 'Updated' },
      });
      await ctrl.update(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 404,
      }));
    });
  });

  // =========================================================================
  // partialUpdate
  // =========================================================================
  describe('partialUpdate', () => {
    test('partially updates record and returns it', async () => {
      const old = { id: 1, name: 'Old', status: 'active', organization_id: 42 };
      const updated = { id: 1, name: 'Old', status: 'inactive', organization_id: 42 };

      db.query
        .mockResolvedValueOnce([[old]])  // findByIdOrFail (old)
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
        .mockResolvedValueOnce([[updated]]);  // findById (updated)

      const { req, res, next } = mockReqRes({ body: { status: 'inactive' } });
      await ctrl.partialUpdate(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ data: updated });
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'partial_update',
        oldValues: old,
        newValues: { status: 'inactive' },
      }));
    });

    test('returns 404 when record not found', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const { req, res, next } = mockReqRes({
        params: { id: '999' },
        body: { status: 'inactive' },
      });
      await ctrl.partialUpdate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 404,
      }));
    });

    test('calls next on error', async () => {
      db.query.mockRejectedValueOnce(new Error('DB error'));

      const { req, res, next } = mockReqRes({ body: { name: 'Test' } });
      await ctrl.partialUpdate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  // =========================================================================
  // destroy
  // =========================================================================
  describe('destroy', () => {
    test('deletes record and returns 204', async () => {
      const record = { id: 1, name: 'Test', organization_id: 42 };
      db.query
        .mockResolvedValueOnce([[record]])  // findByIdOrFail
        .mockResolvedValueOnce([{ affectedRows: 1 }]);  // DELETE

      const { req, res, next } = mockReqRes();
      await ctrl.destroy(req, res, next);

      expect(res.status).toHaveBeenCalledWith(204);
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete',
        oldValues: record,
      }));
    });

    test('returns 404 when record not found', async () => {
      db.query.mockResolvedValueOnce([[]]);

      const { req, res, next } = mockReqRes({ params: { id: '999' } });
      await ctrl.destroy(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({
        statusCode: 404,
      }));
    });
  });
});
