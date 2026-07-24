// =============================================================================
// Tests: Late Fee Service
// =============================================================================

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/services/eventBus', () => ({ emit: jest.fn() }));
jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const db = require('../src/config/database');
const eventBus = require('../src/services/eventBus');
const lateFeeService = require('../src/services/lateFeeService');

describe('lateFeeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // getLateFeeRules
  // ---------------------------------------------------------------------------

  describe('getLateFeeRules', () => {
    it('returns rules for an org', async () => {
      const rules = [{ id: 1, name: 'Standard Late Fee', fee_type: 'flat', fee_amount: 5 }];
      db.query.mockResolvedValueOnce([rules]);
      const result = await lateFeeService.getLateFeeRules(1);
      expect(result).toEqual(rules);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('late_fee_rules'), [1]);
    });
  });

  // ---------------------------------------------------------------------------
  // createLateFeeRule
  // ---------------------------------------------------------------------------

  describe('createLateFeeRule', () => {
    it('inserts and returns a new rule', async () => {
      const newRule = { id: 1, name: 'Late Fee', fee_type: 'flat', fee_amount: 5, grace_period_days: 3, max_applications: 1, is_active: 1 };
      db.query
        .mockResolvedValueOnce([{ insertId: 1 }]) // INSERT
        .mockResolvedValueOnce([[newRule]]);        // SELECT by id

      const result = await lateFeeService.createLateFeeRule(1, {
        name: 'Late Fee',
        fee_type: 'flat',
        fee_amount: 5,
        grace_period_days: 3,
        max_applications: 1,
      });
      expect(result).toEqual(newRule);
    });
  });

  // ---------------------------------------------------------------------------
  // deleteLateFeeRule
  // ---------------------------------------------------------------------------

  describe('deleteLateFeeRule', () => {
    it('returns true when a row is deleted', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 1 }]);
      const result = await lateFeeService.deleteLateFeeRule(1, 1);
      expect(result).toBe(true);
    });

    it('returns false when no row is deleted', async () => {
      db.query.mockResolvedValueOnce([{ affectedRows: 0 }]);
      const result = await lateFeeService.deleteLateFeeRule(1, 999);
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // applyLateFees
  // ---------------------------------------------------------------------------

  describe('applyLateFees', () => {
    it('returns early when no active rules', async () => {
      db.query.mockResolvedValueOnce([[]]); // empty rules
      const result = await lateFeeService.applyLateFees(1);
      expect(result).toEqual({ fees_applied: 0, invoices_checked: 0 });
    });

    it('applies a flat fee to an overdue invoice', async () => {
      const rule = { id: 1, fee_type: 'flat', fee_amount: 10, grace_period_days: 0, max_applications: 1 };
      const invoice = {
        id: 10, invoice_number: 'INV-000010', total: 100, subtotal: 100, tax_amount: 0, tax_rate: 0,
        currency: 'USD', due_date: '2026-05-01', client_id: 5,
        client_name: 'Jane Doe', client_email: 'jane@example.com', client_phone: null,
        days_overdue: 10,
      };

      db.query
        .mockResolvedValueOnce([[rule]])       // SELECT active rules
        .mockResolvedValueOnce([[invoice]])    // SELECT overdue invoices
        .mockResolvedValueOnce([[{ cnt: 0 }]]) // COUNT existing applications → 0
        .mockResolvedValueOnce([{ insertId: 99 }]) // INSERT invoice_items
        .mockResolvedValueOnce([{}])           // INSERT invoice_late_fees
        .mockResolvedValueOnce([{}]);          // UPDATE invoices total

      const result = await lateFeeService.applyLateFees(1);
      expect(result.fees_applied).toBe(1);
      expect(result.invoices_checked).toBe(1);
      expect(eventBus.emit).toHaveBeenCalledWith('invoice.late_fee_applied', expect.objectContaining({
        organizationId: 1,
        fee_amount: 10,
      }));
    });

    it('recomputes subtotal + tax + total consistently — the fee is taxed at the invoice rate', async () => {
      const rule = { id: 1, fee_type: 'flat', fee_amount: 50, grace_period_days: 0, max_applications: 1 };
      const invoice = {
        id: 10, invoice_number: 'INV-000010', total: 1160, subtotal: 1000, tax_amount: 160, tax_rate: 0.16,
        currency: 'MXN', due_date: '2026-05-01', client_id: 5,
        client_name: 'X', client_email: 'x@x.com', client_phone: null, days_overdue: 10,
      };
      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[invoice]])
        .mockResolvedValueOnce([[{ cnt: 0 }]])
        .mockResolvedValueOnce([{ insertId: 99 }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{}]);
      await lateFeeService.applyLateFees(1);
      const upd = db.query.mock.calls.find(c => /UPDATE invoices SET subtotal = subtotal \+/.test(c[0]));
      // DELTA (via applyLineItemToTotals): +50 subtotal, +8 tax (50×0.16), +58 total.
      // Preserves the original tax_amount and keeps total = subtotal + tax.
      expect(upd[1]).toEqual([50, 8, 58, 10]);
    });

    it('excludes invoices that already carry a live CFDI (never mutate a stamped invoice)', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, fee_type: 'flat', fee_amount: 10, grace_period_days: 0, max_applications: 1 }]])
        .mockResolvedValueOnce([[]]);
      await lateFeeService.applyLateFees(1);
      const invQuery = db.query.mock.calls.find(c => /FROM invoices i/.test(c[0]));
      expect(invQuery[0]).toMatch(/NOT EXISTS/);
      expect(invQuery[0]).toMatch(/cfdi_documents/);
      expect(invQuery[0]).toMatch(/sat_status IN \('vigente', 'cancel_pending'\)/);
    });

    it('skips invoice when still within grace period', async () => {
      const rule = { id: 1, fee_type: 'flat', fee_amount: 10, grace_period_days: 5, max_applications: 1 };
      const invoice = { id: 10, days_overdue: 3, total: 100, currency: 'USD', client_id: 5 };

      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[invoice]]);

      const result = await lateFeeService.applyLateFees(1);
      expect(result.fees_applied).toBe(0);
    });

    it('skips invoice when max_applications already reached', async () => {
      const rule = { id: 1, fee_type: 'flat', fee_amount: 10, grace_period_days: 0, max_applications: 1 };
      const invoice = { id: 10, days_overdue: 5, total: 100, currency: 'USD', client_id: 5 };

      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[invoice]])
        .mockResolvedValueOnce([[{ cnt: 1 }]]); // already applied once

      const result = await lateFeeService.applyLateFees(1);
      expect(result.fees_applied).toBe(0);
    });

    it('calculates percent fee correctly', async () => {
      const rule = { id: 1, fee_type: 'percent', fee_amount: 5, grace_period_days: 0, max_applications: null };
      const invoice = {
        id: 10, days_overdue: 2, subtotal: 200, tax_amount: 0, tax_rate: 0, total: 200, currency: 'USD', client_id: 5,
        invoice_number: 'INV-000010', client_name: 'X', client_email: 'x@x.com', client_phone: null,
      };

      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[invoice]])
        .mockResolvedValueOnce([[{ cnt: 0 }]])
        .mockResolvedValueOnce([{ insertId: 10 }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{}]);

      await lateFeeService.applyLateFees(1);
      // 5% of the NET subtotal 200 = 10 (no longer taxed on the gross total)
      expect(eventBus.emit).toHaveBeenCalledWith('invoice.late_fee_applied', expect.objectContaining({
        fee_amount: 10,
      }));
    });

    it('percent fee is on the NET subtotal and taxed exactly once (no double-tax)', async () => {
      const rule = { id: 1, fee_type: 'percent', fee_amount: 5, grace_period_days: 0, max_applications: 1 };
      const invoice = {
        id: 10, invoice_number: 'INV-000010', subtotal: 1000, tax_amount: 160, tax_rate: 0.16, total: 1160,
        currency: 'MXN', days_overdue: 10, client_id: 5, client_name: 'X', client_email: 'x@x.com', client_phone: null,
      };
      db.query
        .mockResolvedValueOnce([[rule]])
        .mockResolvedValueOnce([[invoice]])
        .mockResolvedValueOnce([[{ cnt: 0 }]])
        .mockResolvedValueOnce([{ insertId: 99 }])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([{}]);
      await lateFeeService.applyLateFees(1);
      // fee = 5% of NET 1000 = 50 (NOT 5% of gross 1160 = 58); line amount is the fee itself
      const item = db.query.mock.calls.find(c => /INSERT INTO invoice_items/.test(c[0]));
      expect(item[1][3]).toBe(50);
      // delta: +50 subtotal, +8 tax (taxed once), +58 total — original 160 tax preserved (168 total tax)
      const upd = db.query.mock.calls.find(c => /UPDATE invoices SET subtotal = subtotal \+/.test(c[0]));
      expect(upd[1]).toEqual([50, 8, 58, 10]);
    });
  });
});
