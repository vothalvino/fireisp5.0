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
      // nextInvoiceNumber() reads back LAST_INSERT_ID() via conn.query()
      // (a plain query, not a prepared .execute()) — separate mock queue
      // from mockConnection.execute.
      query: jest.fn().mockResolvedValue([[{ id: 1 }]]),
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
  // nextInvoiceNumber (migration 381 — atomic per-org sequence)
  // =========================================================================
  describe('nextInvoiceNumber', () => {
    test('first-ever call for an org: INSERT IGNORE seeds the row, UPDATE advances it, returns INV-000001', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT IGNORE actually inserted (no prior row)
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE next_number
      mockConnection.query.mockResolvedValueOnce([[{ id: 1 }]]);

      const result = await billingService.nextInvoiceNumber(mockConnection, 42);

      expect(result).toBe('INV-000001');
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);

      const insertIgnoreCall = mockConnection.execute.mock.calls[0];
      expect(insertIgnoreCall[0]).toContain('INSERT IGNORE INTO organization_invoice_sequences');
      expect(insertIgnoreCall[1]).toEqual([42]);

      const updateCall = mockConnection.execute.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE organization_invoice_sequences');
      expect(updateCall[0]).toContain('LAST_INSERT_ID(next_number)');
      expect(updateCall[1]).toEqual([42]);

      expect(mockConnection.query).toHaveBeenCalledWith('SELECT LAST_INSERT_ID() AS id');
    });

    test('increments across repeated calls for the same org (no gaps, no reuse)', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ id: 2 }]])
        .mockResolvedValueOnce([[{ id: 3 }]]);

      const first = await billingService.nextInvoiceNumber(mockConnection, 42);
      const second = await billingService.nextInvoiceNumber(mockConnection, 42);
      const third = await billingService.nextInvoiceNumber(mockConnection, 42);

      expect([first, second, third]).toEqual(['INV-000001', 'INV-000002', 'INV-000003']);
    });

    test('uses sentinel 0 (not NULL) for a null orgId — single-tenant deployment bucket', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query.mockResolvedValueOnce([[{ id: 7 }]]);

      const result = await billingService.nextInvoiceNumber(mockConnection, null);

      expect(result).toBe('INV-000007');
      // Both statements must target the sentinel bucket 0, never NULL — a
      // NULL primary key wouldn't de-duplicate against itself in MySQL.
      expect(mockConnection.execute.mock.calls[0][1]).toEqual([0]);
      expect(mockConnection.execute.mock.calls[1][1]).toEqual([0]);
    });

    test('numbers beyond 999999 grow longer instead of truncating', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query.mockResolvedValueOnce([[{ id: 1000000 }]]);

      const result = await billingService.nextInvoiceNumber(mockConnection, 1);

      expect(result).toBe('INV-1000000');
    });

    // Regression test for the bug this migration fixes: the OLD algorithm
    // (`SELECT COUNT(*) FROM invoices WHERE organization_id = ?` then +1)
    // could hand out an already-used number whenever the row count didn't
    // track the highest issued sequence value — e.g. two concurrent callers
    // reading the same COUNT(*) before either INSERT committed, or the count
    // otherwise diverging from the true max in use. nextInvoiceNumber() is
    // structurally immune: it never reads the `invoices` table at all, so
    // nothing about invoices — soft-deleted, voided, or concurrently
    // in-flight — can influence the number it hands out. Two consecutive
    // calls always advance, never repeat.
    test('never queries the invoices table — immune to the COUNT(*)-based reuse bug', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query
        .mockResolvedValueOnce([[{ id: 4 }]])
        .mockResolvedValueOnce([[{ id: 5 }]]);

      // Simulates: invoice #4 generated, then (soft-)deleted, then another
      // invoice generated for the same org right after — a COUNT(*)-based
      // scheme reading a post-delete count could have handed out 4 again.
      const afterFirstInvoice = await billingService.nextInvoiceNumber(mockConnection, 9);
      const afterSoftDeleteAndSecondInvoice = await billingService.nextInvoiceNumber(mockConnection, 9);

      expect(afterFirstInvoice).toBe('INV-000004');
      expect(afterSoftDeleteAndSecondInvoice).toBe('INV-000005'); // NOT reused as INV-000004
      expect(afterFirstInvoice).not.toBe(afterSoftDeleteAndSecondInvoice);

      for (const call of mockConnection.execute.mock.calls) {
        expect(call[0]).not.toMatch(/FROM invoices/i);
        expect(call[0]).toContain('organization_invoice_sequences');
      }
    });
  });

  // =========================================================================
  // nextQuoteNumber (migration 389 — atomic per-org sequence, mirrors
  // nextInvoiceNumber/migration 381 exactly; quotes had NO auto-numbering at
  // all before this)
  // =========================================================================
  describe('nextQuoteNumber', () => {
    test('first-ever call for an org: INSERT IGNORE seeds the row, UPDATE advances it, returns QUO-000001', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT IGNORE actually inserted (no prior row)
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE next_number
      mockConnection.query.mockResolvedValueOnce([[{ id: 1 }]]);

      const result = await billingService.nextQuoteNumber(mockConnection, 42);

      expect(result).toBe('QUO-000001');
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);

      const insertIgnoreCall = mockConnection.execute.mock.calls[0];
      expect(insertIgnoreCall[0]).toContain('INSERT IGNORE INTO organization_quote_sequences');
      expect(insertIgnoreCall[1]).toEqual([42]);

      const updateCall = mockConnection.execute.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE organization_quote_sequences');
      expect(updateCall[0]).toContain('LAST_INSERT_ID(next_number)');
      expect(updateCall[1]).toEqual([42]);

      expect(mockConnection.query).toHaveBeenCalledWith('SELECT LAST_INSERT_ID() AS id');
    });

    test('increments across repeated calls for the same org (no gaps, no reuse)', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query
        .mockResolvedValueOnce([[{ id: 1 }]])
        .mockResolvedValueOnce([[{ id: 2 }]])
        .mockResolvedValueOnce([[{ id: 3 }]]);

      const first = await billingService.nextQuoteNumber(mockConnection, 42);
      const second = await billingService.nextQuoteNumber(mockConnection, 42);
      const third = await billingService.nextQuoteNumber(mockConnection, 42);

      expect([first, second, third]).toEqual(['QUO-000001', 'QUO-000002', 'QUO-000003']);
    });

    test('uses sentinel 0 (not NULL) for a null orgId — single-tenant deployment bucket', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query.mockResolvedValueOnce([[{ id: 7 }]]);

      const result = await billingService.nextQuoteNumber(mockConnection, null);

      expect(result).toBe('QUO-000007');
      expect(mockConnection.execute.mock.calls[0][1]).toEqual([0]);
      expect(mockConnection.execute.mock.calls[1][1]).toEqual([0]);
    });

    test('numbers beyond 999999 grow longer instead of truncating', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query.mockResolvedValueOnce([[{ id: 1000000 }]]);

      const result = await billingService.nextQuoteNumber(mockConnection, 1);

      expect(result).toBe('QUO-1000000');
    });

    test('never queries the quotes table — immune to the COUNT(*)-based reuse bug', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      mockConnection.query
        .mockResolvedValueOnce([[{ id: 4 }]])
        .mockResolvedValueOnce([[{ id: 5 }]]);

      const afterFirstQuote = await billingService.nextQuoteNumber(mockConnection, 9);
      const afterSoftDeleteAndSecondQuote = await billingService.nextQuoteNumber(mockConnection, 9);

      expect(afterFirstQuote).toBe('QUO-000004');
      expect(afterSoftDeleteAndSecondQuote).toBe('QUO-000005'); // NOT reused as QUO-000004
      expect(afterFirstQuote).not.toBe(afterSoftDeleteAndSecondQuote);

      for (const call of mockConnection.execute.mock.calls) {
        expect(call[0]).not.toMatch(/FROM quotes/i);
        expect(call[0]).toContain('organization_quote_sequences');
      }
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
        .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE (row already exists)
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
        .mockResolvedValueOnce([{ insertId: 50 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT line item
        .mockResolvedValueOnce([[]])  // contract addons (none)
        .mockResolvedValueOnce([])  // UPDATE billing_period
        .mockResolvedValueOnce([]);  // INSERT ledger debit
      mockConnection.query.mockResolvedValueOnce([[{ id: 6 }]]);  // nextInvoiceNumber: SELECT LAST_INSERT_ID()

      db.query.mockResolvedValueOnce([[{ id: 50, total: '580.00', status: 'issued' }]]);  // findById

      const result = await billingService.generateInvoice(billingPeriod, contract, plan, orgId);

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toEqual({ id: 50, total: '580.00', status: 'issued' });

      // 500 subtotal @ 16% -> 80.00 tax, 580.00 total. Assert directly on the
      // INSERT INTO invoices params (not just the separately-mocked findById
      // return above) so this fails if the tax formula regresses.
      const invoiceInsert = mockConnection.execute.mock.calls[4][1];
      expect(invoiceInsert[3]).toBe('INV-000006'); // invoice_number from nextInvoiceNumber()
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
        .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
        .mockResolvedValueOnce([{ insertId: 51 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT line item
        .mockResolvedValueOnce([[]])  // contract addons
        .mockResolvedValueOnce([])  // UPDATE billing_period
        .mockResolvedValueOnce([]);  // INSERT ledger debit
      mockConnection.query.mockResolvedValueOnce([[{ id: 1 }]]);  // nextInvoiceNumber: SELECT LAST_INSERT_ID()

      db.query.mockResolvedValueOnce([[{ id: 51, total: '450.00' }]]);

      await billingService.generateInvoice(billingPeriod, overrideContract, plan, orgId);

      // Verify the invoice INSERT used the override price
      const invoiceInsert = mockConnection.execute.mock.calls[4];
      expect(invoiceInsert[1]).toContain(450);
    });

    test('adds contract addon line items', async () => {
      const addon = { plan_addon_id: 5, addon_name: 'Static IP', addon_price: '100.00', unit_price: null, quantity: 2 };

      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 10, status: 'pending' }]])  // FOR UPDATE lock
        .mockResolvedValueOnce([[]])  // no tax rate
        .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
        .mockResolvedValueOnce([{ insertId: 52 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT plan line item
        .mockResolvedValueOnce([[addon]])  // contract addons
        .mockResolvedValueOnce([])  // INSERT addon line item
        .mockResolvedValueOnce([])  // UPDATE billing_period
        .mockResolvedValueOnce([]);  // INSERT ledger debit
      mockConnection.query.mockResolvedValueOnce([[{ id: 1 }]]);  // nextInvoiceNumber: SELECT LAST_INSERT_ID()

      db.query.mockResolvedValueOnce([[{ id: 52, total: '700.00' }]]);

      await billingService.generateInvoice(billingPeriod, contract, plan, orgId);

      // Addon line item INSERT should be called (1 extra for FOR UPDATE lock,
      // 1 extra for nextInvoiceNumber's INSERT IGNORE + UPDATE pair)
      expect(mockConnection.execute).toHaveBeenCalledTimes(10);
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
        .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
        .mockResolvedValueOnce([{ insertId: 60 }])  // INSERT invoice
        .mockResolvedValueOnce([])  // INSERT invoice_items
        .mockResolvedValueOnce([]);  // INSERT ledger debit
      mockConnection.query.mockResolvedValueOnce([[{ id: 6 }]]);  // nextInvoiceNumber: SELECT LAST_INSERT_ID()

      const result = await billingService.createOneOffInvoice({
        orgId: 42, clientId: 100, contractId: 900, description: 'Installation fee', amount: 500,
      });

      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toEqual({ id: 60, total: '580.00', status: 'issued' });

      const invoiceInsert = mockConnection.execute.mock.calls[3];
      expect(invoiceInsert[0]).toContain('INSERT INTO invoices');
      // 500 subtotal @ 16% -> 80.00 tax, 580.00 total. tax_rate column stores
      // the fraction (0.16), matching what the frontend renders as rate*100.
      expect(invoiceInsert[1]).toEqual([42, 100, 900, 'INV-000006', 500, 80, 580, 'MXN', 0.16, 1, expect.any(Date)]);

      const itemInsert = mockConnection.execute.mock.calls[4];
      expect(itemInsert[0]).toContain('INSERT INTO invoice_items');
      expect(itemInsert[1]).toEqual([60, 'Installation fee', 500, 500]);
    });

    test('defaults contract_id to null and 0% tax when the org has no default tax rate', async () => {
      db.query
        .mockResolvedValueOnce([[{ currency: 'USD' }]])
        .mockResolvedValueOnce([[{ id: 61, total: '500.00' }]]);

      mockConnection.execute
        .mockResolvedValueOnce([[]])  // no default tax rate
        .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
        .mockResolvedValueOnce([{ insertId: 61 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockConnection.query.mockResolvedValueOnce([[{ id: 1 }]]);  // nextInvoiceNumber: SELECT LAST_INSERT_ID()

      await billingService.createOneOffInvoice({
        orgId: 7, clientId: 200, description: 'Installation fee', amount: 500,
      });

      const invoiceInsert = mockConnection.execute.mock.calls[3];
      expect(invoiceInsert[1]).toEqual([7, 200, null, 'INV-000001', 500, 0, 500, 'USD', 0, null, expect.any(Date)]);
    });

    test('uses the currency override instead of Organization.getCurrency when provided', async () => {
      db.query.mockResolvedValueOnce([[{ id: 62, total: '116.00' }]]);  // Invoice.findById (no getCurrency call expected)

      mockConnection.execute
        .mockResolvedValueOnce([[{ id: 1, rate: '0.1600' }]])
        .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE
        .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
        .mockResolvedValueOnce([{ insertId: 62 }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      mockConnection.query.mockResolvedValueOnce([[{ id: 1 }]]);  // nextInvoiceNumber: SELECT LAST_INSERT_ID()

      await billingService.createOneOffInvoice({
        orgId: 7, clientId: 200, description: 'Installation fee', amount: 100, currency: 'GTQ',
      });

      // Only ONE db.query call (Invoice.findById) — Organization.getCurrency
      // was never invoked because a currency override was supplied.
      // (nextInvoiceNumber's LAST_INSERT_ID() read goes through conn.query,
      // i.e. mockConnection.query — a separate mock from the module-level
      // db.query asserted here.)
      expect(db.query).toHaveBeenCalledTimes(1);
      const invoiceInsert = mockConnection.execute.mock.calls[3];
      expect(invoiceInsert[1]).toEqual([7, 200, null, 'INV-000001', 100, 16, 116, 'GTQ', 0.16, 1, expect.any(Date)]);
    });

    test('external-conn mode reuses the caller-owned connection: no begin/commit/release, reads back via the same conn', async () => {
      const externalConn = {
        beginTransaction: jest.fn(),
        execute: jest.fn()
          .mockResolvedValueOnce([[{ id: 1, rate: '0.1600' }]])
          .mockResolvedValueOnce([{ affectedRows: 0 }])  // nextInvoiceNumber: INSERT IGNORE
          .mockResolvedValueOnce([{ affectedRows: 1 }])  // nextInvoiceNumber: UPDATE next_number
          .mockResolvedValueOnce([{ insertId: 70 }])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]),
        // Two conn.query() calls happen on this connection: first
        // nextInvoiceNumber's SELECT LAST_INSERT_ID(), then the "read back
        // through the same conn" SELECT once the invoice row exists.
        query: jest.fn()
          .mockResolvedValueOnce([[{ id: 1 }]])
          .mockResolvedValueOnce([[{ id: 70, total: '580.00', status: 'issued' }]]),
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
