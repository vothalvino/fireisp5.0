// =============================================================================
// FireISP 5.0 — CreditNote.addItem() / Quote.addItem() never write a GENERATED column
// =============================================================================
// credit_note_items.total and quote_items.total are both
// `GENERATED ALWAYS AS (quantity * unit_price) STORED` (database/schema.sql).
// MySQL rejects ANY explicit value for a generated column
// (ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN) — an earlier "fix" renamed the
// bogus `amount` column to `total`, which is legal-looking (the column exists)
// but still 500s on every call, because a generated column cannot be written at
// all. Neither table has a plain writable `amount` column either (unlike
// invoice_items, which has BOTH a writable `amount` and a generated `total` —
// the two tables are NOT the same shape).
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const fs = require('fs');
const path = require('path');
const db = require('../src/config/database');
const CreditNote = require('../src/models/CreditNote');
const Quote = require('../src/models/Quote');
const { parseSchema } = require('../src/scripts/sql-column-check');

const SCHEMA = parseSchema(
  fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8'),
);

describe('CreditNote.addItem() / Quote.addItem() vs GENERATED total', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('schema fixture: total is GENERATED and there is no amount column on either table', () => {
    for (const table of ['credit_note_items', 'quote_items']) {
      const t = SCHEMA.get(table);
      expect(t).toBeDefined();
      expect(t.columns.has('total')).toBe(true);
      expect(t.columns.has('amount')).toBe(false);
    }
  });

  test('CreditNote.addItem() never writes total or amount, and returns the computed row', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 9 }])
      .mockResolvedValueOnce([[{ id: 9, credit_note_id: 3, description: 'Refund', quantity: '1.00', unit_price: '50.00', total: '50.00' }]]);

    const row = await CreditNote.addItem({
      credit_note_id: 3, description: 'Refund', quantity: 1, unit_price: 50, amount: 999, tax_rate_id: null,
    });

    const [insertSql, insertParams] = db.query.mock.calls[0];
    expect(insertSql).toMatch(/INSERT INTO credit_note_items/i);
    expect(insertSql).not.toMatch(/\btotal\b/);
    expect(insertSql).not.toMatch(/\bamount\b/);
    expect(insertParams).not.toContain(999);  // the (deliberately wrong) amount must never be bound

    // total comes back from MySQL's computation, not from what we sent.
    expect(row.total).toBe('50.00');
  });

  test('Quote.addItem() never writes total or amount, and returns the computed row', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 12 }])
      .mockResolvedValueOnce([[{ id: 12, quote_id: 4, description: 'Install', quantity: '2.00', unit_price: '25.00', total: '50.00' }]]);

    const row = await Quote.addItem({
      quote_id: 4, description: 'Install', quantity: 2, unit_price: 25, amount: 999, tax_rate_id: null,
    });

    const [insertSql, insertParams] = db.query.mock.calls[0];
    expect(insertSql).toMatch(/INSERT INTO quote_items/i);
    expect(insertSql).not.toMatch(/\btotal\b/);
    expect(insertSql).not.toMatch(/\bamount\b/);
    expect(insertParams).not.toContain(999);  // the (deliberately wrong) amount must never be bound

    expect(row.total).toBe('50.00');
  });
});
