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

const db = require('../src/config/database');
const auditLog = require('../src/services/auditLog');

describe('auditLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('inserts audit log entry with all fields', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 1 }]);

    await auditLog.log({
      userId: 5,
      organizationId: 42,
      action: 'create',
      tableName: 'clients',
      recordId: 100,
      newValues: { name: 'John' },
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [5, 42, 'create', 'clients', 100, null, JSON.stringify({ name: 'John' })],
    );
  });

  test('logs update with old and new values', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 2 }]);

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
      [5, 42, 'update', 'clients', 100, JSON.stringify({ name: 'Old' }), JSON.stringify({ name: 'New' })],
    );
  });

  test('handles null optional fields', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 3 }]);

    await auditLog.log({
      action: 'delete',
      tableName: 'clients',
      recordId: 100,
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      [null, null, 'delete', 'clients', 100, null, null],
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

    expect(console.error).toHaveBeenCalledWith('Audit log error:', 'Connection lost');
  });
});
