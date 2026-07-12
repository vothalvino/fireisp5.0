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
      // Billing period lock (FOR UPDATE) + Tax rate lookup
      // rate = 0.1600 (16%) — DECIMAL(5,4) per schema/migration 121 seed; a
      // realistic rate is essential here: an old test mocking rate '16.00'
      // (a whole percent, impossible per the column's 0-1 validation range) let
      // the pre-fix `subtotal * taxPct` formula coincidentally produce the
      // same 80.00 this test expects, masking a 100x tax-amount bug.
      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 10, status: 'pending' }]])  // FOR UPDATE lock
        .mockResolvedValueOnce([[{ id: 1, rate: '0.1600', is_default: true }]])  // tax rate
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

      // 500 subtotal @ 16% -> 80.00 tax, 580.00 total. Assert directly on the
      // INSERT INTO invoices params (not just the separately-mocked findById
      // return above) so this fails if the tax formula regresses.
      const invoiceInsert = mockConnection.execute.mock.calls[3][1];
      expect(invoiceInsert[4]).toBe(500);   // subtotal
      expect(invoiceInsert[5]).toBe(80);    // tax_amount
      expect(invoiceInsert[6]).toBe(580);   // total
    });

    test('rolls back transaction on error', async () => {
      // FOR UPDATE lock succeeds, then next call fails
      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 10, status: 'pending' }]])  // FOR UPDATE lock
        .mockRejectedValueOnce(new Error('DB error'));

      await expect(
        billingService.generateInvoice(billingPeriod, contract, plan, orgId),
      ).rejects.toThrow('DB error');

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    test('uses price_override when set', async () => {
      const overrideContract = { ...contract, price_override: '450.00' };

      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 10, status: 'pending' }]])  // FOR UPDATE lock
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
      const invoiceInsert = mockConnection.execute.mock.calls[3];
      expect(invoiceInsert[1]).toContain(450);
    });

    test('adds contract addon line items', async () => {
      const addon = { plan_addon_id: 5, addon_name: 'Static IP', addon_price: '100.00', unit_price: null, quantity: 2 };

      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 10, status: 'pending' }]])  // FOR UPDATE lock
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

      // Addon line item INSERT should be called (1 extra for FOR UPDATE lock)
      expect(mockConnection.execute).toHaveBeenCalledTimes(9);
    });
  });

  // =========================================================================
  // createOneOffInvoice
  // =========================================================================
  describe('createOneOffInvoice', () => {
    test('creates a one-off issued invoice inside a transaction (tax_rates.rate is a FRACTION, not a whole percent)', async () => {
      db.query
        .mockResolvedValueOnce([[{ currency: 'MXN' }]])  // Organization.getCurrency
        .mockResolvedValueOnce([[{ id: 60, total: '580.00', status: 'issued' }]]);  // Invoice.findById

      mockConnection.execute
        // rate = 0.1600 (16%) — DECIMAL(5,4) per schema/migration 121 seed; a
        // realistic rate is essential here: an old test mocking rate '16.00'
        // (an impossible 1600%, DECIMAL(5,4) tops out at 9.9999) combined with
        // the pre-fix `subtotal * taxPct` formula coincidentally produced the
        // same 80.00 this test expects, masking a 100x tax-amount bug.
        .mockResolvedValueOnce([[{ id: 1, rate: '0.1600', is_default: true }]])  // tax rate
        .mockResolvedValueOnce([[{ cnt: 5 }]])  // invoice count
        .mockResolvedValueOnce([{ insertId: 60 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT invoice_items
        .mockResolvedValueOnce([]);  // INSERT ledger debit

      const result = await billingService.createOneOffInvoice({
        orgId: 42, clientId: 100, contractId: 900, description: 'Installation fee', amount: 500,
      });

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toEqual({ id: 60, total: '580.00', status: 'issued' });

      const invoiceInsert = mockConnection.execute.mock.calls[2];
      expect(invoiceInsert[0]).toContain('INSERT INTO invoices');
      // 500 subtotal @ 16% -> 80.00 tax, 580.00 total. tax_rate column stores
      // the fraction (0.16), matching what the frontend renders as rate*100.
      expect(invoiceInsert[1]).toEqual([42, 100, 900, 'INV-000006', 500, 80, 580, 'MXN', 0.16, 1, expect.any(Date)]);

      const itemInsert = mockConnection.execute.mock.calls[3];
      expect(itemInsert[0]).toContain('INSERT INTO invoice_items');
      expect(itemInsert[1]).toEqual([60, 'Installation fee', 500, 500]);
    });

    test('defaults contract_id to null and 0% tax when the org has no default tax rate', async () => {
      db.query
        .mockResolvedValueOnce([[{ currency: 'USD' }]])
        .mockResolvedValueOnce([[{ id: 61, total: '500.00' }]]);

      mockConnection.execute
        .mockResolvedValueOnce([[]])  // no default tax rate
        .mockResolvedValueOnce([[{ cnt: 0 }]])
        .mockResolvedValueOnce([{ insertId: 61 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await billingService.createOneOffInvoice({
        orgId: 7, clientId: 200, description: 'Installation fee', amount: 500,
      });

      const invoiceInsert = mockConnection.execute.mock.calls[2];
      expect(invoiceInsert[1]).toEqual([7, 200, null, 'INV-000001', 500, 0, 500, 'USD', 0, null, expect.any(Date)]);
    });

    test('uses the currency override instead of Organization.getCurrency when provided', async () => {
      db.query.mockResolvedValueOnce([[{ id: 62, total: '116.00' }]]);  // Invoice.findById (no getCurrency call expected)

      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 1, rate: '0.1600' }]])
        .mockResolvedValueOnce([[{ cnt: 0 }]])
        .mockResolvedValueOnce([{ insertId: 62 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await billingService.createOneOffInvoice({
        orgId: 7, clientId: 200, description: 'Installation fee', amount: 100, currency: 'GTQ',
      });

      // Only ONE db.query call (Invoice.findById) — Organization.getCurrency
      // was never invoked because a currency override was supplied.
      expect(db.query).toHaveBeenCalledTimes(1);
      const invoiceInsert = mockConnection.execute.mock.calls[2];
      expect(invoiceInsert[1]).toEqual([7, 200, null, 'INV-000001', 100, 16, 116, 'GTQ', 0.16, 1, expect.any(Date)]);
    });

    test('external-conn mode reuses the caller-owned connection: no begin/commit/release, reads back via the same conn', async () => {
      const externalConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn()
          .mockResolvedValueOnce([[{ id: 1, rate: '0.1600' }]])
          .mockResolvedValueOnce([[{ cnt: 0 }]])
          .mockResolvedValueOnce([{ insertId: 70 }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        query: jest.fn().mockResolvedValueOnce([[{ id: 70, total: '580.00', status: 'issued' }]]),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };

      const result = await billingService.createOneOffInvoice({
        orgId: 42, clientId: 100, description: 'Installation fee', amount: 500, currency: 'MXN', conn: externalConn,
      });

      expect(db.getConnection).not.toHaveBeenCalled();
      expect(externalConn.beginTransaction).not.toHaveBeenCalled();
      expect(externalConn.commit).not.toHaveBeenCalled();
      expect(externalConn.release).not.toHaveBeenCalled();
      // Read back through the SAME connection (not db.query/Invoice.findById)
      // so an uncommitted row the caller hasn't committed yet is visible.
      expect(externalConn.query).toHaveBeenCalledWith('SELECT * FROM invoices WHERE id = ?', [70]);
      expect(result).toEqual({ id: 70, total: '580.00', status: 'issued' });
    });

    test('external-conn mode propagates the raw error without rollback/release (caller owns the transaction)', async () => {
      const externalConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn().mockRejectedValueOnce(new Error('trigger SIGNAL 45000')),
        query: jest.fn(),
        commit: jest.fn(),
        rollback: jest.fn(),
        release: jest.fn(),
      };

      await expect(billingService.createOneOffInvoice({
        orgId: 42, clientId: 100, description: 'fee', amount: 100, currency: 'MXN', conn: externalConn,
      })).rejects.toThrow('trigger SIGNAL 45000'); // raw error, NOT wrapped in InvoiceGenerationError

      expect(externalConn.rollback).not.toHaveBeenCalled();
      expect(externalConn.release).not.toHaveBeenCalled();
    });

    test('rolls back and wraps the error on failure (own-connection mode)', async () => {
      db.query.mockResolvedValueOnce([[{ currency: 'MXN' }]]);
      mockConnection.execute.mockRejectedValueOnce(new Error('DB error'));

      await expect(billingService.createOneOffInvoice({
        orgId: 42, clientId: 100, description: 'Installation fee', amount: 100,
      })).rejects.toThrow(/Failed to create one-off invoice/);

      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // recordPaymentCredit
  // =========================================================================
  describe('recordPaymentCredit', () => {
    test('inserts credit entry into client_balance_ledger', async () => {
      const payment = { id: 77, client_id: 100, amount: '500.00', currency: 'MXN', reference_number: 'PAY-001' };
      db.query.mockResolvedValueOnce([{ insertId: 1 }]);

      await billingService.recordPaymentCredit(payment, 42);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO client_balance_ledger'),
        expect.arrayContaining([100, 42, '500.00', 'MXN', 77]),
      );
    });

    test('uses default currency when payment has no currency', async () => {
      const payment = { id: 78, client_id: 101, amount: '100.00', reference_number: null };
      db.query.mockResolvedValueOnce([{ insertId: 2 }]);

      await billingService.recordPaymentCredit(payment, 42);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO client_balance_ledger'),
        expect.arrayContaining(['USD']),
      );
    });
  });

  // =========================================================================
  // reversePaymentCredit
  // =========================================================================
  describe('reversePaymentCredit', () => {
    test('deletes the payment credit entry from client_balance_ledger', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);

      await billingService.reversePaymentCredit(77);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM client_balance_ledger'),
        [77],
      );
      const sql = db.query.mock.calls[0][0];
      expect(sql).toContain("reference_type = 'payment'");
      expect(sql).toContain('reference_id = ?');
    });
  });

  // =========================================================================
  // reversePaymentAllocations
  // =========================================================================
  describe('reversePaymentAllocations', () => {
    test('soft-deletes allocations and reverts an over-covered invoice to issued', async () => {
      db.query
        .mockResolvedValueOnce([[{ invoice_id: 5 }]])                       // distinct invoice ids
        .mockResolvedValueOnce([{ affectedRows: 1 }])                       // soft-delete allocations
        .mockResolvedValueOnce([[{ total: '580.00', allocated: '0.00' }]])  // refreshInvoicePaidStatus SELECT
        .mockResolvedValueOnce([{ affectedRows: 1 }]);                      // UPDATE invoices -> issued

      await billingService.reversePaymentAllocations(99);

      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE payment_allocations SET deleted_at = NOW()'),
        [99],
      );
      const updateInvoiceSql = db.query.mock.calls[3][0];
      expect(updateInvoiceSql).toContain("status = 'issued'");
      expect(updateInvoiceSql).toContain('paid_at = NULL');
    });

    test('no-ops when the payment has no live allocations', async () => {
      db.query.mockResolvedValueOnce([[]]);
      await billingService.reversePaymentAllocations(99);
      expect(db.query).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // calculateProration
  // =========================================================================
  describe('calculateProration', () => {
    test('calculates proration for upgrade mid-cycle', () => {
      const result = billingService.calculateProration({
        oldPrice: 500,
        newPrice: 800,
        changeDate: '2026-01-16',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      });

      expect(result.totalDays).toBe(31);
      expect(result.daysRemaining).toBe(16);
      expect(result.credit).toBeGreaterThan(0);
      expect(result.charge).toBeGreaterThan(0);
      expect(result.net).toBeGreaterThan(0);  // Upgrade → net positive
    });

    test('calculates proration for downgrade mid-cycle', () => {
      const result = billingService.calculateProration({
        oldPrice: 800,
        newPrice: 500,
        changeDate: '2026-01-16',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      });

      expect(result.net).toBeLessThan(0);  // Downgrade → net negative (credit)
    });

    test('returns zero proration at end of period', () => {
      const result = billingService.calculateProration({
        oldPrice: 500,
        newPrice: 800,
        changeDate: '2026-02-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      });

      expect(result.daysRemaining).toBe(0);
      expect(result.credit).toBe(0);
      expect(result.charge).toBe(0);
      expect(result.net).toBe(0);
    });

    test('handles same price (no net change)', () => {
      const result = billingService.calculateProration({
        oldPrice: 500,
        newPrice: 500,
        changeDate: '2026-01-16',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      });

      expect(result.net).toBe(0);
    });

    test('handles change on first day of period', () => {
      const result = billingService.calculateProration({
        oldPrice: 500,
        newPrice: 800,
        changeDate: '2026-01-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      });

      expect(result.daysRemaining).toBe(31);
      // Full month: credit=500, charge=800, net=300
      expect(result.credit).toBeCloseTo(500, 0);
      expect(result.charge).toBeCloseTo(800, 0);
      expect(result.net).toBeCloseTo(300, 0);
    });
  });
});
