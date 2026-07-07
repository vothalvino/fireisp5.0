// =============================================================================
// FireISP 5.0 — Audit Log Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => logger),
  };
  return logger;
});

const db = require('../src/config/database');
const auditLog = require('../src/services/auditLog');
const logger = require('../src/utils/logger');

describe('auditLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // INSERT column order (migration 374): user_id, organization_id, action,
  // entity_type, entity_id, summary, old_values, new_values.
  test('inserts into entity_type/entity_id — NOT the nonexistent table_name/record_id', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 1 }]);

    await auditLog.log({
      userId: 5,
      organizationId: 42,
      action: 'create',
      tableName: 'clients',
      recordId: 100,
      newValues: { name: 'John' },
    });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_logs');
    expect(sql).toContain('entity_type');
    expect(sql).toContain('entity_id');
    // Regression guard: the columns that never existed must not reappear.
    expect(sql).not.toMatch(/table_name|record_id/);
    expect(params).toEqual([5, 42, 'create', 'clients', 100, null, null, JSON.stringify({ name: 'John' })]);
  });

  test('accepts the entityType/entityId param spelling too', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 2 }]);

    await auditLog.log({
      userId: 7,
      organizationId: 42,
      action: 'partial_update',
      entityType: 'invoices',
      entityId: 900,
      summary: 'marked paid',
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [7, 42, 'partial_update', 'invoices', 900, 'marked paid', null, null],
    );
  });

  test('logs update with old and new values', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 3 }]);

    await auditLog.log({
      userId: 5,
      organizationId: 42,
      action: 'update',
      tableName: 'clients',
      recordId: 100,
      oldValues: { name: 'Old' },
      newValues: { name: 'New' },
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [5, 42, 'update', 'clients', 100, null, JSON.stringify({ name: 'Old' }), JSON.stringify({ name: 'New' })],
    );
  });

  test('accepts a non-ENUM action verb (widened to VARCHAR in migration 374)', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 4 }]);

    await auditLog.log({ action: 'soft_delete', tableName: 'contracts', recordId: 12 });

    const [, params] = db.query.mock.calls[0];
    expect(params[2]).toBe('soft_delete');
  });

  test('handles null optional fields', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 5 }]);

    await auditLog.log({
      action: 'delete',
      tableName: 'clients',
      recordId: 100,
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [null, null, 'delete', 'clients', 100, null, null, null],
    );
  });

  test('does not throw on database error (silent failure)', async () => {
    db.query.mockRejectedValueOnce(new Error('Connection lost'));

    await expect(
      auditLog.log({
        userId: 5,
        action: 'create',
        tableName: 'clients',
        recordId: 100,
      }),
    ).resolves.not.toThrow();

    expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, 'Audit log error');
  });
});
