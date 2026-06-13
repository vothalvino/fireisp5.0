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
  sendRadiusDisconnect: jest.fn(),
  sendRadiusCoA: jest.fn(),
}));

jest.mock('../src/services/radiusService', () => ({
  syncAllAccounts: jest.fn().mockResolvedValue({ synced: 0, total: 0 }),
  syncFreeradiusTables: jest.fn().mockResolvedValue({ synced: 0, errors: 0, plans_synced: 0 }),
  checkCertificateExpiry: jest.fn().mockResolvedValue({ expiring_soon: 0, certificates: [] }),
}));

jest.mock('../src/services/snmpPoller', () => ({
  poll: jest.fn(),
}));

jest.mock('../src/services/emailTransport', () => ({
  processQueue: jest.fn(),
  sendEmail: jest.fn(),
}));

jest.mock('../src/services/webhookService', () => ({
  processRetries: jest.fn(),
}));

jest.mock('../src/services/checkoutService', () => ({
  processRecurringCharges: jest.fn(),
}));

jest.mock('../src/services/alertService', () => ({
  evaluateAlerts: jest.fn(),
}));

jest.mock('../src/services/retentionService', () => ({
  runAll: jest.fn(),
}));

jest.mock('../src/services/paymentRetryService', () => ({
  processPendingRetries: jest.fn(),
}));

jest.mock('../src/views/emailTemplates', () => ({
  invoiceEmail: jest.fn(() => ({ subject: 'Test', html: '<p>Test</p>' })),
  suspensionWarningEmail: jest.fn(() => ({ subject: 'Test', html: '<p>Test</p>' })),
  serviceSuspendedEmail: jest.fn(() => ({ subject: 'Test', html: '<p>Test</p>' })),
}));

jest.mock('../src/scripts/backup', () => ({
  backup: jest.fn(),
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const suspensionService = require('../src/services/suspensionService');
const radiusService = require('../src/services/radiusService');
const emailTransport = require('../src/services/emailTransport');
const taskRunner = require('../src/services/taskRunner');

describe('taskRunner', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    radiusService.syncAllAccounts.mockResolvedValue({ synced: 0, total: 0 });
    emailTransport.sendEmail.mockResolvedValue({});
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
      db.query.mockResolvedValueOnce([[]]);  // runSuspensionWarnings: no rules

      const result = await taskRunner.runTask('auto_suspend_overdue', 42);
      expect(result).toHaveProperty('contracts_suspended', 0);
    });

    test('dispatches radius_sync task', async () => {
      db.query.mockResolvedValueOnce([[]]); // no contracts with radius
      const result = await taskRunner.runTask('radius_sync');
      expect(result).toHaveProperty('synced', 0);
      expect(result).toHaveProperty('total', 0);
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

    test('dispatches generate_scheduled_reports task', async () => {
      // processScheduledReports: no due schedules
      db.query.mockResolvedValueOnce([[]]); // scheduled_reports SELECT
      const result = await taskRunner.runTask('generate_scheduled_reports');
      expect(result).toHaveProperty('processed', 0);
      expect(result).toHaveProperty('failed', 0);
      expect(result).toHaveProperty('total', 0);
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
        status: 'active', client_id: 10,
      };
      const period = { id: 100, status: 'pending' };

      db.query.mockResolvedValueOnce([[contract]]);  // contracts
      billingService.generateBillingPeriod.mockResolvedValueOnce(period);
      billingService.generateInvoice.mockResolvedValueOnce({ id: 200 });
      // client fetch for email (no email → silently skipped)
      db.query.mockResolvedValueOnce([[{ name: 'Test', email: null, org_name: 'ISP' }]]);
      db.query.mockResolvedValueOnce([[]]);  // invoice items

      const result = await taskRunner.runAutoInvoice(42);
      expect(result.invoices_generated).toBe(1);
      expect(result.contracts_checked).toBe(1);
      expect(result).toHaveProperty('emails_sent');
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
          contract: { id: 10, invoice_id: 50, client_id: 99 },
        },
      ]);
      suspensionService.suspendContract.mockResolvedValueOnce();
      db.query.mockResolvedValueOnce([[{ name: 'Client', email: 'client@example.com', org_name: 'ISP' }]]);  // suspension email client lookup
      db.query.mockResolvedValueOnce([[]]);  // runSuspensionWarnings: no rules

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
      db.query.mockResolvedValueOnce([[]]);  // runSuspensionWarnings: no rules

      const result = await taskRunner.runAutoSuspend(42);
      expect(result.contracts_suspended).toBe(0);
      expect(suspensionService.suspendContract).not.toHaveBeenCalled();
    });

    test('processes multiple organizations', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1 }, { id: 2 }]]);
      suspensionService.evaluateRules
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      db.query.mockResolvedValueOnce([[]]);  // runSuspensionWarnings: no rules

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

  // =========================================================================
  // handleDataRetentionComplianceCheck
  // =========================================================================
  describe('handleDataRetentionComplianceCheck', () => {
    it('dispatches data_retention_compliance_check', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, organization_id: 10, client_id: 5, request_type: 'access', due_at: '2026-01-01' }]])
        .mockResolvedValueOnce([[]]); // stale gov_data_requests
      const result = await taskRunner.runTask('data_retention_compliance_check', null);
      expect(result).toHaveProperty('overdue_dsar_requests');
      expect(result).toHaveProperty('stale_gov_data_requests');
    });

    it('returns zero counts when no overdue items', async () => {
      db.query
        .mockResolvedValueOnce([[]])  // overdue dsar_requests
        .mockResolvedValueOnce([[]]); // stale gov_data_requests
      const result = await taskRunner.handleDataRetentionComplianceCheck(null);
      expect(result.overdue_dsar_requests).toBe(0);
      expect(result.stale_gov_data_requests).toBe(0);
    });
  });
});
