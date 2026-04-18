// =============================================================================
// FireISP 5.0 — Automated Billing Cycle Tests (Milestone 1.6)
// =============================================================================
// Tests the full automated billing engine:
//   runAutoInvoice  — generate invoices + email clients
//   runSuspensionWarnings — advance warning emails before suspension
//   runAutoSuspend  — evaluate rules + suspend + email post-suspension
//   runBillingCycle — full orchestrator
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

jest.mock('../src/services/emailTransport', () => ({
  sendEmail: jest.fn(),
  processQueue: jest.fn(),
  init: jest.fn(),
}));

jest.mock('../src/services/radiusService', () => ({ syncAllAccounts: jest.fn() }));
jest.mock('../src/services/snmpPoller', () => ({ poll: jest.fn() }));
jest.mock('../src/services/webhookService', () => ({ retryPending: jest.fn() }));
jest.mock('../src/services/checkoutService', () => ({ processRecurringCharges: jest.fn() }));
jest.mock('../src/services/alertService', () => ({ evaluateAlerts: jest.fn() }));
jest.mock('../src/services/retentionService', () => ({ runAll: jest.fn() }));
jest.mock('../src/services/paymentRetryService', () => ({ processPendingRetries: jest.fn() }));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const suspensionService = require('../src/services/suspensionService');
const emailTransport = require('../src/services/emailTransport');
const taskRunner = require('../src/services/taskRunner');

// ─── helpers ─────────────────────────────────────────────────────────────────

const makeContract = (overrides = {}) => ({
  id: 1,
  client_id: 10,
  organization_id: 42,
  plan_id: 5,
  plan_name: 'Basic 50Mbps',
  plan_price: '500.00',
  plan_currency: 'MXN',
  status: 'active',
  ...overrides,
});

const makeClient = (overrides = {}) => ({
  name: 'Juan Pérez',
  email: 'juan@example.com',
  org_name: 'TestISP',
  ...overrides,
});

const makeInvoice = (overrides = {}) => ({
  id: 200,
  invoice_number: 'INV-000001',
  total: '580.00',
  currency: 'MXN',
  due_date: '2026-05-15',
  client_id: 10,
  ...overrides,
});

// =============================================================================
// runAutoInvoice — invoice generation + email notification
// =============================================================================
describe('runAutoInvoice — email notification after generation', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('generates invoice and sends email to client', async () => {
    const contract = makeContract();
    const period = { id: 100, status: 'pending' };
    const invoice = makeInvoice();
    const client = makeClient();
    const items = [{ description: 'Basic 50Mbps — Jan to Jan', amount: '500.00' }];

    db.query
      .mockResolvedValueOnce([[contract]])      // fetch contracts
      .mockResolvedValueOnce([[client]])        // fetch client for email
      .mockResolvedValueOnce([items]);          // fetch invoice items

    billingService.generateBillingPeriod.mockResolvedValueOnce(period);
    billingService.generateInvoice.mockResolvedValueOnce(invoice);
    emailTransport.sendEmail.mockResolvedValueOnce({ success: true });

    const result = await taskRunner.runAutoInvoice(42);

    expect(result.invoices_generated).toBe(1);
    expect(result.emails_sent).toBe(1);
    expect(result.contracts_checked).toBe(1);
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 42,
        to: 'juan@example.com',
        subject: expect.stringContaining('INV-000001'),
        html: expect.stringContaining('580.00'),
      }),
    );
  });

  test('counts generated=1, emails_sent=0 when client has no email', async () => {
    const contract = makeContract();
    const period = { id: 100, status: 'pending' };
    const invoice = makeInvoice();

    db.query
      .mockResolvedValueOnce([[contract]])
      .mockResolvedValueOnce([[{ name: 'No Email', email: null, org_name: 'ISP' }]])
      .mockResolvedValueOnce([[]]);

    billingService.generateBillingPeriod.mockResolvedValueOnce(period);
    billingService.generateInvoice.mockResolvedValueOnce(invoice);

    const result = await taskRunner.runAutoInvoice(42);

    expect(result.invoices_generated).toBe(1);
    expect(result.emails_sent).toBe(0);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('counts generated=1, emails_sent=0 when client row not found', async () => {
    const contract = makeContract();
    const period = { id: 100, status: 'pending' };
    const invoice = makeInvoice();

    db.query
      .mockResolvedValueOnce([[contract]])
      .mockResolvedValueOnce([[]])   // no client row
      .mockResolvedValueOnce([[]]);

    billingService.generateBillingPeriod.mockResolvedValueOnce(period);
    billingService.generateInvoice.mockResolvedValueOnce(invoice);

    const result = await taskRunner.runAutoInvoice(42);

    expect(result.invoices_generated).toBe(1);
    expect(result.emails_sent).toBe(0);
  });

  test('invoice is counted even when email send fails', async () => {
    const contract = makeContract();
    const period = { id: 100, status: 'pending' };
    const invoice = makeInvoice();
    const client = makeClient();

    db.query
      .mockResolvedValueOnce([[contract]])
      .mockResolvedValueOnce([[client]])
      .mockResolvedValueOnce([[]]);

    billingService.generateBillingPeriod.mockResolvedValueOnce(period);
    billingService.generateInvoice.mockResolvedValueOnce(invoice);
    emailTransport.sendEmail.mockRejectedValueOnce(new Error('SMTP down'));

    const result = await taskRunner.runAutoInvoice(42);

    expect(result.invoices_generated).toBe(1);
    expect(result.emails_sent).toBe(0);  // email failed silently
  });

  test('skips email when period is already invoiced', async () => {
    const contract = makeContract();
    const period = { id: 100, status: 'invoiced' };

    db.query.mockResolvedValueOnce([[contract]]);
    billingService.generateBillingPeriod.mockResolvedValueOnce(period);

    const result = await taskRunner.runAutoInvoice(42);

    expect(result.invoices_generated).toBe(0);
    expect(result.emails_sent).toBe(0);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('handles multiple contracts — emails each', async () => {
    const contract1 = makeContract({ id: 1, client_id: 10 });
    const contract2 = makeContract({ id: 2, client_id: 11 });
    const period = { id: 100, status: 'pending' };
    const invoice1 = makeInvoice({ id: 201, invoice_number: 'INV-000001' });
    const invoice2 = makeInvoice({ id: 202, invoice_number: 'INV-000002' });
    const client1 = makeClient({ email: 'a@example.com' });
    const client2 = makeClient({ email: 'b@example.com' });
    const items = [];

    db.query
      .mockResolvedValueOnce([[contract1, contract2]])
      .mockResolvedValueOnce([[client1]])
      .mockResolvedValueOnce([items])
      .mockResolvedValueOnce([[client2]])
      .mockResolvedValueOnce([items]);

    billingService.generateBillingPeriod
      .mockResolvedValueOnce(period)
      .mockResolvedValueOnce(period);
    billingService.generateInvoice
      .mockResolvedValueOnce(invoice1)
      .mockResolvedValueOnce(invoice2);
    emailTransport.sendEmail.mockResolvedValue({ success: true });

    const result = await taskRunner.runAutoInvoice(42);

    expect(result.invoices_generated).toBe(2);
    expect(result.emails_sent).toBe(2);
    expect(emailTransport.sendEmail).toHaveBeenCalledTimes(2);
  });

  test('returns emails_sent in result object', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const result = await taskRunner.runAutoInvoice();
    expect(result).toHaveProperty('emails_sent', 0);
    expect(result).toHaveProperty('invoices_generated', 0);
    expect(result).toHaveProperty('contracts_checked', 0);
  });
});

// =============================================================================
// runSuspensionWarnings — advance warning emails
// =============================================================================
describe('runSuspensionWarnings — advance warning emails', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('sends warning email for contract approaching suspension threshold', async () => {
    const rule = {
      id: 1,
      org_id: 42,
      organization_id: 42,
      days_past_due: 30,
      notify_before_days: 7,
      is_active: true,
    };
    const contract = {
      contract_id: 10,
      client_id: 50,
      organization_id: 42,
      invoice_id: 500,
      invoice_number: 'INV-000010',
      total: '580.00',
      currency: 'MXN',
      due_date: '2026-01-01',
      days_overdue: 24,
    };
    const client = makeClient({ email: 'client@example.com' });

    db.query
      .mockResolvedValueOnce([[rule]])
      .mockResolvedValueOnce([[contract]])
      .mockResolvedValueOnce([[client]]);

    emailTransport.sendEmail.mockResolvedValueOnce({ success: true });

    const result = await taskRunner.runSuspensionWarnings(42);

    expect(result.warnings_sent).toBe(1);
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 42,
        to: 'client@example.com',
        subject: expect.stringContaining('Suspension Warning'),
        html: expect.stringContaining('580.00'),
      }),
    );
  });

  test('skips warning when client has no email', async () => {
    const rule = {
      id: 1, org_id: 42, days_past_due: 30, notify_before_days: 7, is_active: true,
    };
    const contract = {
      contract_id: 10, client_id: 50, organization_id: 42,
      invoice_number: 'INV-000010', total: '580.00', currency: 'MXN',
      due_date: '2026-01-01', days_overdue: 24,
    };

    db.query
      .mockResolvedValueOnce([[rule]])
      .mockResolvedValueOnce([[contract]])
      .mockResolvedValueOnce([[{ name: 'No Email', email: null, org_name: 'ISP' }]]);

    const result = await taskRunner.runSuspensionWarnings(42);
    expect(result.warnings_sent).toBe(0);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('returns warnings_sent=0 when no rules have notify_before_days', async () => {
    db.query.mockResolvedValueOnce([[]]);  // no rules

    const result = await taskRunner.runSuspensionWarnings(42);
    expect(result.warnings_sent).toBe(0);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('silently skips warning when email send fails', async () => {
    const rule = {
      id: 1, org_id: 42, days_past_due: 30, notify_before_days: 7, is_active: true,
    };
    const contract = {
      contract_id: 10, client_id: 50, organization_id: 42,
      invoice_number: 'INV-000010', total: '580.00', currency: 'MXN',
      due_date: '2026-01-01', days_overdue: 24,
    };
    const client = makeClient({ email: 'client@example.com' });

    db.query
      .mockResolvedValueOnce([[rule]])
      .mockResolvedValueOnce([[contract]])
      .mockResolvedValueOnce([[client]]);

    emailTransport.sendEmail.mockRejectedValueOnce(new Error('SMTP error'));

    const result = await taskRunner.runSuspensionWarnings(42);
    expect(result.warnings_sent).toBe(0);  // failed silently
  });

  test('skips rules where notify_before_days >= days_past_due (no valid window)', async () => {
    const rule = {
      id: 1, org_id: 42, days_past_due: 5, notify_before_days: 10, is_active: true,
    };

    db.query.mockResolvedValueOnce([[rule]]);

    const result = await taskRunner.runSuspensionWarnings(42);
    // warningStart = 5-10 = -5 < 0, so the rule is skipped
    expect(result.warnings_sent).toBe(0);
    // Should not have queried for contracts
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('works without organizationId filter', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runSuspensionWarnings();
    expect(result.warnings_sent).toBe(0);
    // Query should not include organization_id filter
    expect(db.query.mock.calls[0][1]).toEqual([]);
  });
});

// =============================================================================
// runAutoSuspend — suspension + post-suspension email + warnings
// =============================================================================
describe('runAutoSuspend — suspension with emails and warnings', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('suspends contract and sends post-suspension email', async () => {
    const rule = { id: 1, action: 'auto_suspend' };
    const contract = {
      id: 10, client_id: 50, invoice_id: 500, total: '580.00', currency: 'MXN',
    };
    const client = makeClient({ email: 'client@example.com' });

    // runAutoSuspend: orgs query
    db.query.mockResolvedValueOnce([[{ id: 42 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([{ rule, contract }]);
    suspensionService.suspendContract.mockResolvedValueOnce();
    // post-suspension client fetch
    db.query.mockResolvedValueOnce([[client]]);
    emailTransport.sendEmail.mockResolvedValueOnce({ success: true });
    // runSuspensionWarnings: no rules with notify_before_days
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runAutoSuspend(42);

    expect(result.contracts_suspended).toBe(1);
    expect(suspensionService.suspendContract).toHaveBeenCalledWith(10, 1, null, 500);
    expect(emailTransport.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'client@example.com',
        subject: expect.stringContaining('Suspended'),
      }),
    );
  });

  test('suspension succeeds even when post-suspension email fails', async () => {
    const rule = { id: 1, action: 'auto_suspend' };
    const contract = { id: 10, client_id: 50, invoice_id: 500, total: '580.00', currency: 'MXN' };
    const client = makeClient({ email: 'client@example.com' });

    db.query.mockResolvedValueOnce([[{ id: 42 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([{ rule, contract }]);
    suspensionService.suspendContract.mockResolvedValueOnce();
    db.query.mockResolvedValueOnce([[client]]);
    emailTransport.sendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    // runSuspensionWarnings
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runAutoSuspend(42);
    expect(result.contracts_suspended).toBe(1);
  });

  test('skips post-suspension email when client has no email', async () => {
    const rule = { id: 1, action: 'auto_suspend' };
    const contract = { id: 10, client_id: 50, invoice_id: 500, total: '580.00', currency: 'MXN' };

    db.query.mockResolvedValueOnce([[{ id: 42 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([{ rule, contract }]);
    suspensionService.suspendContract.mockResolvedValueOnce();
    db.query.mockResolvedValueOnce([[{ name: 'No Email', email: null, org_name: 'ISP' }]]);
    // runSuspensionWarnings
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runAutoSuspend(42);
    expect(result.contracts_suspended).toBe(1);
    expect(emailTransport.sendEmail).not.toHaveBeenCalled();
  });

  test('includes warnings_sent in result', async () => {
    db.query.mockResolvedValueOnce([[{ id: 42 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([]);
    // runSuspensionWarnings
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runAutoSuspend(42);
    expect(result).toHaveProperty('warnings_sent', 0);
    expect(result).toHaveProperty('contracts_suspended', 0);
  });

  test('skips rules with action other than auto_suspend', async () => {
    const rule = { id: 1, action: 'notify_only' };
    const contract = { id: 10, client_id: 50, invoice_id: 500 };

    db.query.mockResolvedValueOnce([[{ id: 42 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([{ rule, contract }]);
    db.query.mockResolvedValueOnce([[]]);  // runSuspensionWarnings

    const result = await taskRunner.runAutoSuspend(42);
    expect(result.contracts_suspended).toBe(0);
    expect(suspensionService.suspendContract).not.toHaveBeenCalled();
  });
});

// =============================================================================
// runBillingCycle — full orchestrator
// =============================================================================
describe('runBillingCycle — full billing engine orchestration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('combines results of invoice generation and suspension', async () => {
    // runAutoInvoice: no contracts
    db.query.mockResolvedValueOnce([[]]);
    // runAutoSuspend: orgs
    db.query.mockResolvedValueOnce([[{ id: 42 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([]);
    // runSuspensionWarnings (called inside runAutoSuspend)
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runBillingCycle(42);

    expect(result).toEqual({
      invoices_generated: 0,
      emails_sent: 0,
      contracts_checked: 0,
      contracts_suspended: 0,
      warnings_sent: 0,
    });
  });

  test('returns all five keys in result', async () => {
    db.query.mockResolvedValueOnce([[]]);
    db.query.mockResolvedValueOnce([[{ id: 1 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([]);
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runBillingCycle();

    expect(result).toHaveProperty('invoices_generated');
    expect(result).toHaveProperty('emails_sent');
    expect(result).toHaveProperty('contracts_checked');
    expect(result).toHaveProperty('contracts_suspended');
    expect(result).toHaveProperty('warnings_sent');
  });

  test('billing_cycle task is dispatched via runTask', async () => {
    // runAutoInvoice
    db.query.mockResolvedValueOnce([[]]);
    // runAutoSuspend
    db.query.mockResolvedValueOnce([[{ id: 1 }]]);
    suspensionService.evaluateRules.mockResolvedValueOnce([]);
    // runSuspensionWarnings
    db.query.mockResolvedValueOnce([[]]);

    const result = await taskRunner.runTask('billing_cycle', 1);

    expect(result).toHaveProperty('invoices_generated');
    expect(result).toHaveProperty('contracts_suspended');
  });
});
