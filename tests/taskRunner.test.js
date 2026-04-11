// =============================================================================
// FireISP 5.0 — Task Runner Service Unit Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/billingService', () => ({
  generateBillingPeriod: jest.fn(),
  generateInvoice: jest.fn(),
}));

jest.mock('../src/services/suspensionService', () => ({
  evaluateRules: jest.fn(),
  suspendContract: jest.fn(),
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const suspensionService = require('../src/services/suspensionService');
const taskRunner = require('../src/services/taskRunner');

describe('taskRunner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // listTasks
  // =========================================================================
  describe('listTasks', () => {
    test('returns all tasks when no orgId', async () => {
      const tasks = [{ id: 1, task_name: 'auto_generate_invoices' }];
      db.query.mockResolvedValueOnce([tasks]);

      const result = await taskRunner.listTasks();
      expect(result).toEqual(tasks);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY priority'),
      );
    });

    test('filters by orgId when provided', async () => {
      const tasks = [{ id: 1, task_name: 'auto_generate_invoices' }];
      db.query.mockResolvedValueOnce([tasks]);

      const result = await taskRunner.listTasks(42);
      expect(result).toEqual(tasks);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('organization_id = ?'),
        [42],
      );
    });
  });

  // =========================================================================
  // runTask
  // =========================================================================
  describe('runTask', () => {
    test('dispatches auto_generate_invoices task', async () => {
      db.query.mockResolvedValueOnce([[]]); // no contracts
      const result = await taskRunner.runTask('auto_generate_invoices', 42);
      expect(result).toHaveProperty('invoices_generated');
      expect(result).toHaveProperty('contracts_checked');
    });

    test('dispatches auto_suspend_overdue task', async () => {
      db.query.mockResolvedValueOnce([[{ id: 42 }]]);  // orgs
      suspensionService.evaluateRules.mockResolvedValueOnce([]);

      const result = await taskRunner.runTask('auto_suspend_overdue', 42);
      expect(result).toHaveProperty('contracts_suspended', 0);
    });

    test('returns info message for radius_sync', async () => {
      const result = await taskRunner.runTask('radius_sync');
      expect(result.message).toContain('RADIUS');
    });

    test('returns info message for populate_revenue_summary', async () => {
      const result = await taskRunner.runTask('populate_revenue_summary');
      expect(result.message).toContain('Revenue');
    });

    test('returns info message for populate_network_health_snapshots', async () => {
      const result = await taskRunner.runTask('populate_network_health_snapshots');
      expect(result.message).toContain('Network health');
    });

    test('dispatches csd_expiry_monitor task', async () => {
      db.query.mockResolvedValueOnce([[]]); // no expiring certs
      const result = await taskRunner.runTask('csd_expiry_monitor', 42);
      expect(result).toHaveProperty('expiring_certificates', 0);
    });

    test('returns unknown message for unrecognized task', async () => {
      const result = await taskRunner.runTask('nonexistent_task');
      expect(result.message).toContain('Unknown task');
    });
  });

  // =========================================================================
  // runAutoInvoice
  // =========================================================================
  describe('runAutoInvoice', () => {
    test('generates invoices for active contracts', async () => {
      const contract = {
        id: 1, organization_id: 42, plan_id: 10,
        plan_name: 'Basic', plan_price: '500.00', plan_currency: 'MXN',
        status: 'active',
      };
      const period = { id: 100, status: 'pending' };

      db.query.mockResolvedValueOnce([[contract]]);  // contracts
      billingService.generateBillingPeriod.mockResolvedValueOnce(period);
      billingService.generateInvoice.mockResolvedValueOnce({ id: 200 });

      const result = await taskRunner.runAutoInvoice(42);
      expect(result.invoices_generated).toBe(1);
      expect(result.contracts_checked).toBe(1);
    });

    test('skips contracts where period is already invoiced', async () => {
      const contract = { id: 1, organization_id: 42, plan_name: 'Basic', plan_price: '500.00', plan_currency: 'MXN' };
      const period = { id: 100, status: 'invoiced' };

      db.query.mockResolvedValueOnce([[contract]]);
      billingService.generateBillingPeriod.mockResolvedValueOnce(period);

      const result = await taskRunner.runAutoInvoice(42);
      expect(result.invoices_generated).toBe(0);
      expect(billingService.generateInvoice).not.toHaveBeenCalled();
    });

    test('silently skips contracts that fail', async () => {
      const contract = { id: 1, organization_id: 42, plan_name: 'Basic', plan_price: '500.00', plan_currency: 'MXN' };

      db.query.mockResolvedValueOnce([[contract]]);
      billingService.generateBillingPeriod.mockRejectedValueOnce(new Error('Already invoiced'));

      const result = await taskRunner.runAutoInvoice(42);
      expect(result.invoices_generated).toBe(0);
    });

    test('processes all contracts without org filter', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await taskRunner.runAutoInvoice();
      expect(result.contracts_checked).toBe(0);
    });
  });

  // =========================================================================
  // runAutoSuspend
  // =========================================================================
  describe('runAutoSuspend', () => {
    test('suspends overdue contracts per rules', async () => {
      db.query.mockResolvedValueOnce([[{ id: 42 }]]);  // organizations
      suspensionService.evaluateRules.mockResolvedValueOnce([
        {
          rule: { id: 1, action: 'auto_suspend' },
          contract: { id: 10, invoice_id: 50 },
        },
      ]);
      suspensionService.suspendContract.mockResolvedValueOnce();

      const result = await taskRunner.runAutoSuspend(42);
      expect(result.contracts_suspended).toBe(1);
      expect(suspensionService.suspendContract).toHaveBeenCalledWith(10, 1, null, 50);
    });

    test('skips rules that are not auto_suspend', async () => {
      db.query.mockResolvedValueOnce([[{ id: 42 }]]);
      suspensionService.evaluateRules.mockResolvedValueOnce([
        {
          rule: { id: 1, action: 'notify' },
          contract: { id: 10, invoice_id: 50 },
        },
      ]);

      const result = await taskRunner.runAutoSuspend(42);
      expect(result.contracts_suspended).toBe(0);
      expect(suspensionService.suspendContract).not.toHaveBeenCalled();
    });

    test('processes multiple organizations', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]]);
      suspensionService.evaluateRules
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await taskRunner.runAutoSuspend();
      expect(result.contracts_suspended).toBe(0);
      expect(suspensionService.evaluateRules).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // runCsdExpiryCheck
  // =========================================================================
  describe('runCsdExpiryCheck', () => {
    test('returns expiring certificates', async () => {
      const certs = [
        { id: 1, rfc: 'XAXX010101000', valid_to: '2026-05-01' },
        { id: 2, rfc: 'XBXX020202000', valid_to: '2026-04-20' },
      ];
      db.query.mockResolvedValueOnce([certs]);

      const result = await taskRunner.runCsdExpiryCheck(42);
      expect(result.expiring_certificates).toBe(2);
      expect(result.certificates).toHaveLength(2);
    });

    test('returns 0 when no certificates expiring', async () => {
      db.query.mockResolvedValueOnce([[]]);
      const result = await taskRunner.runCsdExpiryCheck(42);
      expect(result.expiring_certificates).toBe(0);
    });
  });

  // =========================================================================
  // markTaskRun
  // =========================================================================
  describe('markTaskRun', () => {
    test('updates last_run_at and status', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      await taskRunner.markTaskRun('auto_generate_invoices');
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE scheduled_tasks'),
        ['completed', 'auto_generate_invoices'],
      );
    });
  });
});
