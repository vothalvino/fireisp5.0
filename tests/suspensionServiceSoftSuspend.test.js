// =============================================================================
// FireISP 5.0 — Suspension Service: Soft Suspend & Exemption Tests
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

describe('suspensionService — soft suspend & exemption', () => {
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

  // ===========================================================================
  // isClientSuspensionExempt
  // ===========================================================================
  describe('isClientSuspensionExempt', () => {
    test('returns { exempt: true, reason: "VIP" } when client has suspension_exempt=1', async () => {
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: 1,
        suspension_exempt_reason: 'VIP',
      }]]);

      const result = await suspensionService.isClientSuspensionExempt(10);

      expect(result.exempt).toBe(true);
      expect(result.reason).toBe('VIP');
    });

    test('returns { exempt: false, reason: null } when client has suspension_exempt=0', async () => {
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: 0,
        suspension_exempt_reason: null,
      }]]);

      const result = await suspensionService.isClientSuspensionExempt(10);

      expect(result.exempt).toBe(false);
      expect(result.reason).toBeNull();
    });

    test('returns { exempt: false, reason: null } when contract not found', async () => {
      db.query.mockResolvedValueOnce([[]]); // no rows

      const result = await suspensionService.isClientSuspensionExempt(9999);

      expect(result.exempt).toBe(false);
      expect(result.reason).toBeNull();
    });

    test('queries contracts joined to clients with correct contractId', async () => {
      db.query.mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]]);

      await suspensionService.isClientSuspensionExempt(42);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('suspension_exempt'),
        [42],
      );
    });

    test('treats suspension_exempt=null as not exempt', async () => {
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: null,
        suspension_exempt_reason: null,
      }]]);

      const result = await suspensionService.isClientSuspensionExempt(10);

      expect(result.exempt).toBe(false);
    });

    test('returns reason string when suspension_exempt_reason is set', async () => {
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: 1,
        suspension_exempt_reason: 'Government account',
      }]]);

      const result = await suspensionService.isClientSuspensionExempt(5);
      expect(result.reason).toBe('Government account');
    });
  });

  // ===========================================================================
  // softSuspendContract
  // ===========================================================================
  describe('softSuspendContract', () => {
    test('skips when client is suspension-exempt (returns { skipped: true })', async () => {
      // isClientSuspensionExempt calls db.query — return exempt client
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: 1,
        suspension_exempt_reason: 'VIP',
      }]]);

      const result = await suspensionService.softSuspendContract(10, 1, 5, 50, 512, 256);

      expect(result).toMatchObject({ skipped: true });
      // Should not have called db.query for RADIUS or suspension_logs
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('calls db.query for RADIUS lookup and inserts suspension_log for non-exempt client', async () => {
      // isClientSuspensionExempt: not exempt
      db.query.mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]]);
      // sendRadiusCoA → sendRadiusDisconnect → db.query for RADIUS lookup (no RADIUS account)
      db.query.mockResolvedValueOnce([[]]); // no RADIUS rows
      // INSERT suspension_logs
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await suspensionService.softSuspendContract(10, 1, 5, 50, 512, 256);

      // At minimum: isClientSuspensionExempt query + RADIUS lookup + INSERT
      expect(db.query).toHaveBeenCalledTimes(3);

      // The INSERT into suspension_logs should have 'soft_suspend' action
      const insertCall = db.query.mock.calls[2];
      expect(insertCall[0]).toContain('INSERT INTO suspension_logs');
      expect(insertCall[0]).toContain('soft_suspend');
    });

    test('inserts suspension_log with correct contractId and ruleId', async () => {
      db.query
        .mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]])
        .mockResolvedValueOnce([[]])  // no RADIUS
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      await suspensionService.softSuspendContract(15, 3, 7, 55, 1024, 512);

      const insertCall = db.query.mock.calls[2];
      expect(insertCall[1]).toContain(15);  // contractId
      expect(insertCall[1]).toContain(3);   // ruleId
      expect(insertCall[1]).toContain(7);   // userId
      expect(insertCall[1]).toContain(55);  // invoiceId
    });
  });

  // ===========================================================================
  // evaluateRules (updated — excludes suspension_exempt clients)
  // ===========================================================================
  describe('evaluateRules (excludes suspension_exempt clients)', () => {
    test('SQL query contains suspension_exempt filter', async () => {
      const rule = { id: 1, days_past_due: 15, grace_period_days: 0, action: 'auto_suspend', is_enabled: true };

      db.query
        .mockResolvedValueOnce([[rule]])  // rules
        .mockResolvedValueOnce([[]]); // no matching contracts

      await suspensionService.evaluateRules(1);

      const contractsQuery = db.query.mock.calls[1];
      expect(contractsQuery[0]).toContain('suspension_exempt');
      expect(contractsQuery[0]).toContain('= 0');
    });

    test('suspension_exempt=1 clients do not appear in results', async () => {
      const rule = { id: 1, days_past_due: 10, grace_period_days: 0 };
      // The query filters them out at the DB level — when mock returns empty
      // (simulating the DB excluding them), results should be empty
      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[]]); // DB filtered out exempt clients

      const results = await suspensionService.evaluateRules(1);
      expect(results).toHaveLength(0);
    });

    test('returns non-exempt contracts normally', async () => {
      const rule = { id: 1, days_past_due: 15, grace_period_days: 5 };
      const contract = { id: 20, status: 'active', days_overdue: 18 };

      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[contract]]); // non-exempt contract returned

      const results = await suspensionService.evaluateRules(1);
      expect(results).toHaveLength(1);
      expect(results[0].contract.id).toBe(20);
    });

    test('uses COALESCE for suspension_exempt to handle NULL values', async () => {
      const rule = { id: 1, days_past_due: 10, grace_period_days: 0 };

      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[]]); // no contracts

      await suspensionService.evaluateRules(5);

      const contractsQuery = db.query.mock.calls[1];
      expect(contractsQuery[0]).toContain('COALESCE');
    });
  });

  // ===========================================================================
  // suspendContract (updated — returns { skipped: true } when client is exempt)
  // ===========================================================================
  describe('suspendContract (with exemption check)', () => {
    test('returns { skipped: true } when client is exempt', async () => {
      // isClientSuspensionExempt query returns exempt
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: 1,
        suspension_exempt_reason: 'VIP',
      }]]);

      const result = await suspensionService.suspendContract(10, 1, 5, 50);

      expect(result).toMatchObject({ skipped: true });
      // Should not attempt to get a DB connection for the transaction
      expect(db.getConnection).not.toHaveBeenCalled();
    });

    test('returns { skipped: true } with the exemption reason', async () => {
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: 1,
        suspension_exempt_reason: 'Municipal contract',
      }]]);

      const result = await suspensionService.suspendContract(10, 1, 5, 50);

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('Municipal contract');
    });

    test('proceeds with suspension when client is not exempt', async () => {
      // isClientSuspensionExempt: not exempt
      db.query.mockResolvedValueOnce([[{ suspension_exempt: 0, suspension_exempt_reason: null }]]);
      // RADIUS lookup in sendRadiusDisconnect: no RADIUS account
      db.query.mockResolvedValueOnce([[]]); // no RADIUS

      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // UPDATE contracts
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT suspension_logs

      await suspensionService.suspendContract(10, 1, 5, 50);

      expect(db.getConnection).toHaveBeenCalled();
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
    });

    test('does not use DB connection for transaction when client is exempt', async () => {
      db.query.mockResolvedValueOnce([[{
        suspension_exempt: 1,
        suspension_exempt_reason: 'VIP',
      }]]);

      await suspensionService.suspendContract(20, 2, 8, 60);

      expect(mockConnection.beginTransaction).not.toHaveBeenCalled();
      expect(mockConnection.execute).not.toHaveBeenCalled();
    });
  });
});
