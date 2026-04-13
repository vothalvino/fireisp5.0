// =============================================================================
// FireISP 5.0 — E2E Workflow: Billing → Invoice → Payment
// =============================================================================
// Full billing cycle test: generate billing period → create invoice → record
// payment credit.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const eventBus = require('../src/services/eventBus');

describe('E2E Workflow: Billing → Invoice → Payment', () => {
  let mockConnection;
  const emittedEvents = [];

  beforeEach(() => {
    jest.clearAllMocks();
    emittedEvents.length = 0;
    mockConnection = {
      beginTransaction: jest.fn(),
      execute: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(mockConnection);
    eventBus.removeAllListeners();
    eventBus.on('*', (data) => emittedEvents.push(data));
  });

  afterAll(() => { eventBus.removeAllListeners(); });

  // =========================================================================
  // Step 1: Generate billing period
  // =========================================================================
  test('Step 1: generates billing period for active contract', async () => {
    const contract = {
      id: 1,
      client_id: 10,
      plan_id: 5,
      start_date: '2026-01-01',
      billing_day: 1,
      status: 'active',
      price_override: null,
      tax_rate_id: null,
    };

    db.query
      .mockResolvedValueOnce([[]])  // no pending billing period
      .mockResolvedValueOnce([[]])  // no last invoiced period
      .mockResolvedValueOnce([{ insertId: 100 }])
      .mockResolvedValueOnce([[{
        id: 100,
        contract_id: 1,
        status: 'pending',
        period_start: '2026-01-01',
        period_end: '2026-01-31',
      }]]);

    const period = await billingService.generateBillingPeriod(contract);
    expect(period).toBeDefined();
    expect(period.status).toBe('pending');
    expect(period.contract_id).toBe(1);
  });

  // =========================================================================
  // Step 2: Generate invoice from billing period
  // =========================================================================
  test('Step 2: creates invoice from billing period', async () => {
    const period = { id: 100, contract_id: 1, period_start: '2026-01-01', period_end: '2026-01-31' };
    const contract = { id: 1, client_id: 10, plan_id: 5, price_override: null, organization_id: 1 };
    const plan = { id: 5, name: 'Basic 50Mbps', price: '500.00', currency: 'MXN' };

    const createdInvoice = {
      id: 200, invoice_number: 'INV-000001', client_id: 10,
      subtotal: '500.00', tax_amount: '80.00', total: '580.00',
      status: 'issued', currency: 'MXN',
    };

    mockConnection.execute
      .mockResolvedValueOnce([[{ id: 1, rate: '16.00', is_default: true }]])  // tax rate
      .mockResolvedValueOnce([[{ cnt: 0 }]])  // invoice count
      .mockResolvedValueOnce([{ insertId: 200 }])  // INSERT invoice
      .mockResolvedValueOnce([])  // INSERT invoice item
      .mockResolvedValueOnce([[]])  // no plan addons
      .mockResolvedValueOnce([])   // UPDATE billing_period → invoiced
      .mockResolvedValueOnce([]);  // INSERT client_balance_ledger

    // Invoice.findById uses db.query (not conn.execute)
    db.query.mockResolvedValueOnce([[createdInvoice]]);

    const invoice = await billingService.generateInvoice(period, contract, plan, 1);
    expect(invoice).toBeDefined();
    expect(invoice.id).toBe(200);
    expect(invoice.total).toBe('580.00');
    expect(invoice.status).toBe('issued');
  });

  // =========================================================================
  // Step 3: Record payment credit against invoice
  // =========================================================================
  test('Step 3: records payment credit in ledger', async () => {
    const payment = {
      id: 300,
      invoice_id: 200,
      client_id: 10,
      amount: '580.00',
      currency: 'MXN',
      organization_id: 1,
    };

    db.query.mockResolvedValueOnce([{ insertId: 1 }]);  // INSERT client_balance_ledger

    // recordPaymentCredit returns undefined — just ensure no error thrown
    await expect(billingService.recordPaymentCredit(payment, 1)).resolves.not.toThrow();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('client_balance_ledger'),
      expect.any(Array),
    );
  });

  // =========================================================================
  // Full pipeline integration
  // =========================================================================
  test('full pipeline: period → invoice → payment credit', async () => {
    // Step 1: billing period
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 100 }])
      .mockResolvedValueOnce([[{
        id: 100, contract_id: 1, status: 'pending',
        period_start: '2026-01-01', period_end: '2026-01-31',
      }]]);

    const contract = { id: 1, client_id: 10, plan_id: 5, start_date: '2026-01-01', billing_day: 1, price_override: null, tax_rate_id: null };
    const period = await billingService.generateBillingPeriod(contract);
    expect(period.id).toBe(100);

    // Step 2: invoice (uses connection mock for conn.execute, then db.query for findById)
    mockConnection.execute
      .mockResolvedValueOnce([[{ id: 100, status: 'pending' }]])  // FOR UPDATE lock
      .mockResolvedValueOnce([[{ id: 1, rate: '16.00', is_default: true }]])
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      .mockResolvedValueOnce([{ insertId: 200 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    db.query.mockResolvedValueOnce([[{ id: 200, invoice_number: 'INV-000001', total: '580.00', status: 'issued' }]]);

    const plan = { id: 5, name: 'Basic', price: '500.00', currency: 'MXN' };
    const invoice = await billingService.generateInvoice(period, contract, plan, 1);
    expect(invoice.id).toBe(200);

    // Step 3: record payment credit
    db.query.mockResolvedValueOnce([{ insertId: 1 }]);
    const payment = { id: 300, invoice_id: 200, client_id: 10, amount: '580.00', currency: 'MXN', organization_id: 1 };
    await expect(billingService.recordPaymentCredit(payment, 1)).resolves.not.toThrow();

    // Full pipeline completed
    expect(db.getConnection).toHaveBeenCalled();
    expect(mockConnection.commit).toHaveBeenCalled();
  });
});
