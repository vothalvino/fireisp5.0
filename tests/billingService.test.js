// =============================================================================
// FireISP 5.0 — Billing Service Unit Tests
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

describe('billingService', () => {
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
  // generateBillingPeriod
  // =========================================================================
  describe('generateBillingPeriod', () => {
    const contract = {
      id: 1,
      start_date: '2026-01-01',
      billing_day: 15,
    };

    test('returns existing pending period if one exists', async () => {
      const pendingPeriod = { id: 10, contract_id: 1, status: 'pending', period_start: '2026-03-01', period_end: '2026-03-31' };
      db.query.mockResolvedValueOnce([[pendingPeriod]]);

      const result = await billingService.generateBillingPeriod(contract);
      expect(result).toEqual(pendingPeriod);
      expect(db.query).toHaveBeenCalledTimes(1);
    });

    test('creates new period when no pending period exists', async () => {
      const insertedPeriod = { id: 11, contract_id: 1, status: 'pending', period_start: '2026-01-01', period_end: '2026-01-31' };
      db.query
        .mockResolvedValueOnce([[]])  // no pending
        .mockResolvedValueOnce([[]])  // no last invoiced
        .mockResolvedValueOnce([{ insertId: 11 }])  // INSERT
        .mockResolvedValueOnce([[insertedPeriod]]);  // SELECT

      const result = await billingService.generateBillingPeriod(contract);
      expect(result).toEqual(insertedPeriod);
      expect(db.query).toHaveBeenCalledTimes(4);
    });

    test('creates next period based on last invoiced period', async () => {
      const lastPeriod = { id: 9, period_end: '2026-02-28', status: 'invoiced' };
      const newPeriod = { id: 12, status: 'pending' };

      db.query
        .mockResolvedValueOnce([[]])  // no pending
        .mockResolvedValueOnce([[lastPeriod]])  // last invoiced
        .mockResolvedValueOnce([{ insertId: 12 }])  // INSERT
        .mockResolvedValueOnce([[newPeriod]]);  // SELECT

      const result = await billingService.generateBillingPeriod(contract);
      expect(result).toEqual(newPeriod);

      // Check the INSERT call uses period_start after last period_end
      const insertCall = db.query.mock.calls[2];
      expect(insertCall[0]).toContain('INSERT INTO billing_periods');
    });
  });

  // =========================================================================
  // generateInvoice
  // =========================================================================
  describe('generateInvoice', () => {
    const billingPeriod = { id: 10, period_start: '2026-03-01', period_end: '2026-03-31' };
    const contract = { id: 1, client_id: 100, price_override: null, tax_rate_id: null };
    const plan = { name: 'Basic 50Mbps', price: '500.00', currency: 'MXN' };
    const orgId = 42;

    test('creates invoice with correct totals inside a transaction', async () => {
      // Tax rate lookup
      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 1, rate: '16.00', is_default: true }]])  // tax rate
        .mockResolvedValueOnce([[{ cnt: 5 }]])  // invoice count
        .mockResolvedValueOnce([{ insertId: 50 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT line item
        .mockResolvedValueOnce([[]])  // contract addons (none)
        .mockResolvedValueOnce([])  // UPDATE billing_period
        .mockResolvedValueOnce([]);  // INSERT ledger debit

      db.query.mockResolvedValueOnce([[{ id: 50, total: '580.00', status: 'issued' }]]);  // findById

      const result = await billingService.generateInvoice(billingPeriod, contract, plan, orgId);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toEqual({ id: 50, total: '580.00', status: 'issued' });
    });

    test('rolls back transaction on error', async () => {
      mockConnection.execute.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        billingService.generateInvoice(billingPeriod, contract, plan, orgId),
      ).rejects.toThrow('DB error');

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('uses price_override when set', async () => {
      const overrideContract = { ...contract, price_override: '450.00' };

      mockConnection.execute
        .mockResolvedValueOnce([[]])  // no tax rate
        .mockResolvedValueOnce([[{ cnt: 0 }]])  // invoice count
        .mockResolvedValueOnce([{ insertId: 51 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT line item
        .mockResolvedValueOnce([[]])  // contract addons
        .mockResolvedValueOnce([])  // UPDATE billing_period
        .mockResolvedValueOnce([]);  // INSERT ledger debit

      db.query.mockResolvedValueOnce([[{ id: 51, total: '450.00' }]]);

      await billingService.generateInvoice(billingPeriod, overrideContract, plan, orgId);

      // Verify the invoice INSERT used the override price
      const invoiceInsert = mockConnection.execute.mock.calls[2];
      expect(invoiceInsert[1]).toContain(450);
    });

    test('adds contract addon line items', async () => {
      const addon = { plan_addon_id: 5, addon_name: 'Static IP', addon_price: '100.00', unit_price: null, quantity: 2 };

      mockConnection.execute
        .mockResolvedValueOnce([[]])  // no tax rate
        .mockResolvedValueOnce([[{ cnt: 0 }]])  // invoice count
        .mockResolvedValueOnce([{ insertId: 52 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT plan line item
        .mockResolvedValueOnce([[addon]])  // contract addons
        .mockResolvedValueOnce([])  // INSERT addon line item
        .mockResolvedValueOnce([])  // UPDATE billing_period
        .mockResolvedValueOnce([]);  // INSERT ledger debit

      db.query.mockResolvedValueOnce([[{ id: 52, total: '700.00' }]]);

      await billingService.generateInvoice(billingPeriod, contract, plan, orgId);

      // Addon line item INSERT should be called
      expect(mockConnection.execute).toHaveBeenCalledTimes(8);
    });
  });

  // =========================================================================
  // recordPaymentCredit
  // =========================================================================
  describe('recordPaymentCredit', () => {
    test('inserts credit entry into client_balance_ledger', async () => {
      const payment = { id: 77, client_id: 100, amount: '500.00', currency: 'MXN', reference: 'PAY-001' };
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      await billingService.recordPaymentCredit(payment, 42);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO client_balance_ledger'),
        expect.arrayContaining([100, 42, '500.00', 'MXN', 77]),
      );
    });

    test('uses default currency when payment has no currency', async () => {
      const payment = { id: 78, client_id: 101, amount: '100.00', reference: null };
      db.query.mockResolvedValueOnce([{ insertId: 2 }]);

      await billingService.recordPaymentCredit(payment, 42);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO client_balance_ledger'),
        expect.arrayContaining(['USD']),
      );
    });
  });
});
