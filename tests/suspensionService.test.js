// =============================================================================
// FireISP 5.0 — Suspension Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const suspensionService = require('../src/services/suspensionService');

describe('suspensionService', () => {
  let mockConnection;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnection = {
      beginTransaction: jest.fn(),
      execute: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(mockConnection);
  });

  // =========================================================================
  // evaluateRules
  // =========================================================================
  describe('evaluateRules', () => {
    test('returns empty array when no rules exist', async () => {
      db.query.mockResolvedValueOnce([[]]);  // no rules
      const results = await suspensionService.evaluateRules(42);
      expect(results).toEqual([]);
    });

    test('returns matching contracts for each rule', async () => {
      const rule1 = { id: 1, days_past_due: 15, grace_period_days: 5, action: 'auto_suspend', is_enabled: true };
      const rule2 = { id: 2, days_past_due: 30, grace_period_days: 0, action: 'auto_suspend', is_enabled: true };
      const contract1 = { id: 10, status: 'active', invoice_id: 50, days_overdue: 17 };
      const contract2 = { id: 11, status: 'active', invoice_id: 51, days_overdue: 32 };

      db.query
        .mockResolvedValueOnce([[rule1, rule2]])  // rules
        .mockResolvedValueOnce([[contract1]])  // contracts for rule1
        .mockResolvedValueOnce([[contract2]]);  // contracts for rule2

      const results = await suspensionService.evaluateRules(42);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ rule: rule1, contract: contract1 });
      expect(results[1]).toEqual({ rule: rule2, contract: contract2 });
    });

    test('returns multiple contracts per rule', async () => {
      const rule = { id: 1, days_past_due: 15, grace_period_days: 0 };
      const contracts = [
        { id: 10, days_overdue: 20 },
        { id: 11, days_overdue: 18 },
      ];

      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([contracts]);

      const results = await suspensionService.evaluateRules(42);
      expect(results).toHaveLength(2);
    });

    test('queries with correct organization filter', async () => {
      db.query
        .mockResolvedValueOnce([[]])  // no rules
        ;

      await suspensionService.evaluateRules(99);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id = ?'),
        [99],
      );
    });
  });

  // =========================================================================
  // suspendContract
  // =========================================================================
  describe('suspendContract', () => {
    test('suspends contract and logs event within transaction', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      // isClientSuspensionExempt: client NOT exempt
      db.query.mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]]);
      // RADIUS lookup returns empty (no RADIUS account)
      db.query.mockResolvedValueOnce([[]]);

      await suspensionService.suspendContract(10, 1, 5, 50);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);

      // First call: UPDATE contracts
      expect(mockConnection.execute.mock.calls[0][0]).toContain('UPDATE contracts SET status');
      expect(mockConnection.execute.mock.calls[0][1]).toEqual(['suspended', 10]);

      // Second call: INSERT suspension_logs (includes coa_sent and coa_response columns)
      expect(mockConnection.execute.mock.calls[1][0]).toContain('INSERT INTO suspension_logs');
      expect(mockConnection.execute.mock.calls[1][1]).toContain(10);

      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('rolls back on error and releases connection', async () => {
      // isClientSuspensionExempt: client NOT exempt
      db.query.mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]]);
      mockConnection.execute.mockRejectedValueOnce(new Error('DB fail'));

      await expect(
        suspensionService.suspendContract(10, 1, 5, 50),
      ).rejects.toThrow('DB fail');

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // reconnectContract
  // =========================================================================
  describe('reconnectContract', () => {
    test('reactivates contract and logs unsuspend event', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      // RADIUS lookup returns empty (no RADIUS account)
      db.query.mockResolvedValueOnce([[]]);

      await suspensionService.reconnectContract(10, 5, 50);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();

      // UPDATE contracts SET status = active
      expect(mockConnection.execute.mock.calls[0][0]).toContain('UPDATE contracts SET status');
      expect(mockConnection.execute.mock.calls[0][1]).toEqual(['active', 10]);

      // INSERT suspension_logs with 'unsuspend' (includes coa_sent/coa_response)
      expect(mockConnection.execute.mock.calls[1][0]).toContain('INSERT INTO suspension_logs');

      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('rolls back on error', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE
        .mockRejectedValueOnce(new Error('Log fail'));  // INSERT
      // RADIUS lookup
      db.query.mockResolvedValueOnce([[]]);

      await expect(
        suspensionService.reconnectContract(10, 5, 50),
      ).rejects.toThrow('Log fail');

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });
});
