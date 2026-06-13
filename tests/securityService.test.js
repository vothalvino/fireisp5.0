// =============================================================================
// FireISP 5.0 — securityService Unit Tests (§17)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

jest.mock('../src/services/retentionService', () => ({
  runAll: jest.fn(),
}));

const db = require('../src/config/database');
const retentionService = require('../src/services/retentionService');
const securityService = require('../src/services/securityService');

describe('securityService.runSecureDeletion', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('runs retention and logs to secure_deletion_log', async () => {
    retentionService.runAll.mockResolvedValue({
      total_deleted: 5,
      tables: [{ table: 'dsar_requests', deleted: 5, error: null }],
    });
    db.query.mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);

    const result = await securityService.runSecureDeletion(1);
    expect(result.total_deleted).toBe(5);
    expect(result.logged).toBe(true);
    expect(result.tables).toHaveLength(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO secure_deletion_log'),
      expect.any(Array),
    );
  });

  it('skips logging when no records were deleted for a table', async () => {
    retentionService.runAll.mockResolvedValue({
      total_deleted: 0,
      tables: [{ table: 'connection_logs', deleted: 0, error: null }],
    });

    const result = await securityService.runSecureDeletion(1);
    expect(result.total_deleted).toBe(0);
    expect(result.logged).toBe(true);
    // No INSERT since deleted=0
    expect(db.query).not.toHaveBeenCalled();
  });

  it('handles log insertion failure gracefully without throwing', async () => {
    retentionService.runAll.mockResolvedValue({
      total_deleted: 3,
      tables: [{ table: 'audit_logs', deleted: 3, error: null }],
    });
    db.query.mockRejectedValue(new Error('DB write failed'));

    // Should not throw even though the log insertion fails
    const result = await securityService.runSecureDeletion(1);
    expect(result.total_deleted).toBe(3);
    expect(result.logged).toBe(true);
  });

  it('handles multiple tables with mixed deleted counts', async () => {
    retentionService.runAll.mockResolvedValue({
      total_deleted: 7,
      tables: [
        { table: 'dsar_requests', deleted: 5, error: null },
        { table: 'connection_logs', deleted: 0, error: null },
        { table: 'audit_logs', deleted: 2, error: null },
      ],
    });
    db.query.mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);

    const result = await securityService.runSecureDeletion(2);
    expect(result.total_deleted).toBe(7);
    expect(result.logged).toBe(true);
    // Should insert 2 log rows (for dsar_requests and audit_logs, not connection_logs)
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it('handles tables with error property in result', async () => {
    retentionService.runAll.mockResolvedValue({
      total_deleted: 2,
      tables: [{ table: 'dsar_requests', deleted: 2, error: 'partial failure' }],
    });
    db.query.mockResolvedValue([{ insertId: 1, affectedRows: 1 }]);

    const result = await securityService.runSecureDeletion(1);
    expect(result.total_deleted).toBe(2);
    // Verify the error is included in the log details
    const callArgs = db.query.mock.calls[0][1];
    const details = JSON.parse(callArgs[callArgs.length - 1]);
    expect(details.error).toBe('partial failure');
  });
});
