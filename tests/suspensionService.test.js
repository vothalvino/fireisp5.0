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
      const rule1 = { id: 1, days_past_due: 15, grace_period_days: 5, action: 'auto_suspend', is_active: true };
      const rule2 = { id: 2, days_past_due: 30, grace_period_days: 0, action: 'auto_suspend', is_active: true };
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

    test('filters on is_active (not is_enabled) and excludes soft-deleted rules', async () => {
      // suspension_rules.is_enabled has never existed — the real column is
      // is_active (database/schema.sql). Every scheduled dunning run threw
      // before this was fixed, regardless of the suspension_logs INSERT fixes.
      db.query.mockResolvedValueOnce([[]]);

      await suspensionService.evaluateRules(42);

      const [sql] = db.query.mock.calls[0];
      expect(sql).toMatch(/\bis_active\b/);
      expect(sql).not.toMatch(/\bis_enabled\b/);
      expect(sql).toMatch(/deleted_at IS NULL/);
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
      expect(mockConnection.execute).toHaveBeenCalledTimes(3);

      // First call: UPDATE contracts
      expect(mockConnection.execute.mock.calls[0][0]).toContain('UPDATE contracts SET status');
      expect(mockConnection.execute.mock.calls[0][1]).toEqual(['suspended', 10]);

      // Second call: deactivate the RADIUS account (Bug 2 — a suspended
      // contract's PPPoE credentials must stop authenticating NEW sessions)
      expect(mockConnection.execute.mock.calls[1][0]).toContain('UPDATE radius SET status');
      expect(mockConnection.execute.mock.calls[1][0]).toContain("'suspended'");
      expect(mockConnection.execute.mock.calls[1][1]).toEqual([10]);

      // Third call: INSERT suspension_logs (includes coa_sent and coa_response columns)
      expect(mockConnection.execute.mock.calls[2][0]).toContain('INSERT INTO suspension_logs');
      expect(mockConnection.execute.mock.calls[2][1]).toContain(10);

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
      // Open walled-garden suspension_logs lookup: none
      db.query.mockResolvedValueOnce([[]]);

      await suspensionService.reconnectContract(10, 5, 50);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();

      // UPDATE contracts SET status = active
      expect(mockConnection.execute.mock.calls[0][0]).toContain('UPDATE contracts SET status');
      expect(mockConnection.execute.mock.calls[0][1]).toEqual(['active', 10]);

      // Restore the RADIUS account — guarded to only flip a 'suspended' row
      // (Bug 2 — must never resurrect an 'inactive' terminated/cancelled account)
      expect(mockConnection.execute.mock.calls[1][0]).toContain('UPDATE radius SET status');
      expect(mockConnection.execute.mock.calls[1][0]).toContain("'active'");
      expect(mockConnection.execute.mock.calls[1][0]).toContain("status = 'suspended'");
      expect(mockConnection.execute.mock.calls[1][1]).toEqual([10]);

      // INSERT suspension_logs with the ENUM-legal 'unsuspended' action. (Call [2]
      // is now the SELECT that recovers the original suspended_at — see
      // tests/suspensionLogsSchemaContract.test.js for the full column contract.)
      const insertCall = mockConnection.execute.mock.calls
        .find(([sql]) => sql.includes('INSERT INTO suspension_logs'));
      expect(insertCall).toBeDefined();
      expect(insertCall[0]).toContain("'unsuspended'");

      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('lifts walled garden when an open walled_garden log exists', async () => {
      const radiusService = require('../src/services/radiusService');
      const wgSpy = jest
        .spyOn(radiusService, 'walledGardenReconnect')
        .mockResolvedValueOnce(undefined);

      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      // RADIUS lookup returns empty (no RADIUS account)
      db.query.mockResolvedValueOnce([[]]);
      // Open walled-garden suspension_logs lookup: one open entry
      db.query.mockResolvedValueOnce([[{ id: 77 }]]);

      await suspensionService.reconnectContract(10, 5, 50);

      expect(wgSpy).toHaveBeenCalledWith(10, 5);
      wgSpy.mockRestore();
    });

    test('rolls back on error', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE contracts
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE radius
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

  // =========================================================================
  // logSuspensionEvent (migration-384-era shared helper, exported so
  // routes/contracts.js#updateContractHandler can log the generic
  // active<->suspended PUT/PATCH toggle the same way the dedicated
  // /suspend, /unsuspend, and rule-driven soft-suspend paths do)
  // =========================================================================
  describe('logSuspensionEvent', () => {
    test("action='suspended' writes the full column set via the given exec function", async () => {
      const exec = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);

      await suspensionService.logSuspensionEvent(exec, {
        contractId: 10,
        ruleId: 3,
        action: 'suspended',
        reason: 'manual suspend',
        triggeredByValue: 'manual',
        userId: 5,
        coaSent: true,
        coaResponse: 'Disconnect-ACK',
        invoiceId: 50,
      });

      expect(exec).toHaveBeenCalledTimes(1);
      const [sql, params] = exec.mock.calls[0];
      expect(sql).toContain('INSERT INTO suspension_logs');
      expect(sql).toContain("'suspended'");
      expect(sql).toMatch(/FROM\s+contracts\s+c/i);
      expect(params).toEqual([3, 'manual suspend', 'manual', 5, true, 'Disconnect-ACK', 50, 10]);
    });

    test("action='unsuspended' writes suspended_at/restored_at via COALESCE(?, NOW())", async () => {
      const exec = jest.fn().mockResolvedValue([{ affectedRows: 1 }]);
      const suspendedAt = new Date('2026-07-01T10:00:00Z');
      const restoredAt = new Date('2026-07-01T12:00:00Z');

      await suspensionService.logSuspensionEvent(exec, {
        contractId: 10,
        action: 'unsuspended',
        reason: 'manual reconnect',
        triggeredByValue: 'manual',
        userId: 5,
        coaSent: true,
        coaResponse: 'CoA-ACK',
        invoiceId: null,
        suspendedAt,
        restoredAt,
      });

      const [sql, params] = exec.mock.calls[0];
      expect(sql).toContain("'unsuspended'");
      expect(sql).toMatch(/COALESCE\(\?,\s*NOW\(\)\)/i);
      expect(sql).not.toContain('suspension_rule_id');
      expect(params).toEqual(['manual reconnect', 'manual', 5, true, 'CoA-ACK', null, suspendedAt, restoredAt, 10]);
    });

    test('rejects an unsupported action without ever calling exec', async () => {
      const exec = jest.fn();
      await expect(
        suspensionService.logSuspensionEvent(exec, { contractId: 10, action: 'bogus' }),
      ).rejects.toThrow(/unsupported action/);
      expect(exec).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // closeOpenSuspensionAndGetStart
  // =========================================================================
  describe('closeOpenSuspensionAndGetStart', () => {
    test('returns the prior open suspended_at and closes the row', async () => {
      const suspendedAt = new Date('2026-07-01T10:00:00Z');
      const exec = jest.fn()
        .mockResolvedValueOnce([[{ suspended_at: suspendedAt }]])  // SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }]);              // UPDATE close

      const result = await suspensionService.closeOpenSuspensionAndGetStart(exec, 10);

      expect(result).toBe(suspendedAt);
      expect(exec).toHaveBeenCalledTimes(2);
      expect(exec.mock.calls[0][0]).toContain('SELECT suspended_at');
      expect(exec.mock.calls[1][0]).toContain('UPDATE suspension_logs SET restored_at = NOW()');
      expect(exec.mock.calls[1][0]).toMatch(/NOT LIKE 'walled\\_garden:%'/);
    });

    test('returns null when there is no open suspension row', async () => {
      const exec = jest.fn()
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([{ affectedRows: 0 }]);

      const result = await suspensionService.closeOpenSuspensionAndGetStart(exec, 10);
      expect(result).toBeNull();
    });
  });
});
