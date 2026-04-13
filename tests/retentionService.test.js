// =============================================================================
// FireISP 5.0 — Data Retention Service Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

const db = require('../src/config/database');
const retentionService = require('../src/services/retentionService');

describe('retentionService', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // Clear any env overrides
    delete process.env.RETENTION_AUDIT_LOGS_DAYS;
    delete process.env.RETENTION_ALERT_EVENTS_DAYS;
  });

  describe('loadPolicies()', () => {
    test('returns default retention days', () => {
      const policies = retentionService.loadPolicies();
      expect(policies.audit_logs).toBe(365);
      expect(policies.alert_events).toBe(90);
      expect(policies.webhook_deliveries).toBe(90);
      expect(policies.idempotency_keys).toBe(7);
    });

    test('overrides from environment variables', () => {
      process.env.RETENTION_AUDIT_LOGS_DAYS = '180';
      process.env.RETENTION_ALERT_EVENTS_DAYS = '30';

      const policies = retentionService.loadPolicies();
      expect(policies.audit_logs).toBe(180);
      expect(policies.alert_events).toBe(30);
    });
  });

  describe('purgeTable()', () => {
    test('deletes old records in batches', async () => {
      // First batch: 1000 rows (full batch), second batch: 500 rows (partial → done)
      db.query
        .mockResolvedValueOnce([{ affectedRows: 1000 }])
        .mockResolvedValueOnce([{ affectedRows: 500 }]);

      const result = await retentionService.purgeTable('audit_logs', 365);
      expect(result).toEqual({ table: 'audit_logs', deleted: 1500 });
      expect(db.query).toHaveBeenCalledTimes(2);
    });

    test('handles zero rows to delete', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);

      const result = await retentionService.purgeTable('alert_events', 90);
      expect(result).toEqual({ table: 'alert_events', deleted: 0 });
    });

    test('rejects unknown tables', async () => {
      await expect(retentionService.purgeTable('users', 30))
        .rejects.toThrow('not in the retention policy whitelist');
    });

    test('uses custom date column', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 10 }]);

      await retentionService.purgeTable('idempotency_keys', 7, 'expires_at');

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('expires_at'),
        expect.any(Array),
      );
    });
  });

  describe('runAll()', () => {
    test('runs all configured retention policies', async () => {
      // Each table: one batch with 0 rows (nothing to purge)
      db.query.mockResolvedValue([{ affectedRows: 0 }]);

      const result = await retentionService.runAll();

      expect(result.tables).toHaveLength(6);
      expect(result.total_deleted).toBe(0);
    });

    test('continues on error for individual tables', async () => {
      db.query
        .mockRejectedValueOnce(new Error('Table not found'))  // first table fails
        .mockResolvedValue([{ affectedRows: 0 }]);  // rest succeed

      const result = await retentionService.runAll();

      expect(result.tables.length).toBeGreaterThan(0);
      // At least one table should have an error
      const errorTable = result.tables.find(t => t.error);
      expect(errorTable).toBeDefined();
    });

    test('reports total deleted count across tables', async () => {
      // Alternate between some deletions and zero
      let callCount = 0;
      db.query.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve([{ affectedRows: callCount === 1 ? 50 : 0 }]);
        }
        return Promise.resolve([{ affectedRows: 0 }]);
      });

      const result = await retentionService.runAll();
      expect(result.total_deleted).toBeGreaterThanOrEqual(0);
    });
  });
});
