// =============================================================================
// FireISP 5.0 — Client Balance Service Tests
// =============================================================================
// computeClientBalance() is the SINGLE source for the "Account Balance" figure
// shown everywhere (GraphQL Client.balance, the AI support billing module, the
// support-context enrichment, the client portal dashboard) — it replaces the
// old client_balance_ledger-derived figure, which could drift from reality
// because not every money path wrote a ledger entry (see PR brief
// "balance-computed-currency-org"; client 35 on the live demo had a credit-note
// ledger entry showing "in credit" next to a genuinely unpaid open invoice).
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const { computeClientBalance } = require('../src/services/clientBalanceService');

afterEach(() => {
  jest.clearAllMocks();
});

describe('computeClientBalance', () => {
  test('owes case — one open invoice, no payments', async () => {
    db.query
      .mockResolvedValueOnce([[ // getInvoicesWithBalance
        { id: 1, client_id: 5, organization_id: 1, total: '1392.00', currency: 'MXN', status: 'issued', balance_due: '1392.00' },
      ]])
      .mockResolvedValueOnce([[]]) // payments — none
      .mockResolvedValueOnce([[]]); // credit notes — none

    const { balance, currency } = await computeClientBalance(1, 5);
    expect(balance).toBe(1392);
    expect(currency).toBe('MXN');
  });

  test('credit case — no invoices, one completed payment left fully unallocated', async () => {
    db.query
      .mockResolvedValueOnce([[]]) // no payable invoices
      .mockResolvedValueOnce([[
        { amount: '500.00', currency: 'MXN', allocated: '0.00' },
      ]])
      .mockResolvedValueOnce([[]]); // credit notes — none

    const { balance, currency } = await computeClientBalance(1, 5);
    expect(balance).toBe(-500);
    expect(currency).toBe('MXN');
  });

  test('mixed — a partially-allocated invoice plus a payment with a leftover credit', async () => {
    db.query
      .mockResolvedValueOnce([[
        // total 1000.00, 600.00 already allocated -> balance_due 400.00
        { id: 1, total: '1000.00', currency: 'MXN', balance_due: '400.00' },
      ]])
      .mockResolvedValueOnce([[
        // amount 700.00, 600.00 allocated -> 100.00 unallocated remainder
        { amount: '700.00', currency: 'MXN', allocated: '600.00' },
      ]])
      .mockResolvedValueOnce([[]]); // credit notes — none

    const { balance, currency } = await computeClientBalance(1, 5);
    expect(balance).toBe(300); // 400 owed - 100 credit
    expect(currency).toBe('MXN');
  });

  test('a fully-allocated payment contributes nothing (no negative "double credit")', async () => {
    db.query
      .mockResolvedValueOnce([[
        { id: 1, total: '200.00', currency: 'MXN', balance_due: '200.00' },
      ]])
      .mockResolvedValueOnce([[
        { amount: '150.00', currency: 'MXN', allocated: '150.00' }, // fully applied already
      ]])
      .mockResolvedValueOnce([[]]); // credit notes — none

    const { balance } = await computeClientBalance(1, 5);
    expect(balance).toBe(200);
  });

  test('org-scoped — the invoice query is filtered by the given organization_id', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]) // credit notes — none
      .mockResolvedValueOnce([[{ currency: 'MXN' }]]); // Organization.getCurrency fallback (no contributing rows)
    await computeClientBalance(7, 5);

    const [invoiceSql, invoiceParams] = db.query.mock.calls[0];
    expect(invoiceSql).toMatch(/organization_id/);
    expect(invoiceParams).toContain(7);

    const [paymentSql, paymentParams] = db.query.mock.calls[1];
    expect(paymentSql).toMatch(/organization_id/);
    expect(paymentParams).toContain(7);

    const [creditNoteSql, creditNoteParams] = db.query.mock.calls[2];
    expect(creditNoteSql).toMatch(/credit_notes/);
    expect(creditNoteSql).toMatch(/organization_id/);
    expect(creditNoteParams).toContain(7);
  });

  test('client 35 shape — open invoice minus the standing credit note, never the ledger', async () => {
    // The live-demo confusion: the ledger's lone credit-note entry made the
    // page read "in credit" while a 1392 invoice sat open. The computed
    // balance reads the invoice AND the standing credit note from their own
    // tables (never client_balance_ledger): 1392 - 116 = 1276 owed.
    db.query
      .mockResolvedValueOnce([[
        { id: 99, total: '1392.00', currency: 'MXN', balance_due: '1392.00' },
      ]])
      .mockResolvedValueOnce([[]]) // payments — none
      .mockResolvedValueOnce([[
        { total: '116.00', currency: 'MXN' }, // the real standing credit note
      ]]);

    const { balance } = await computeClientBalance(1, 35);
    expect(balance).toBe(1276);
    for (const [sql] of db.query.mock.calls) {
      expect(sql).not.toMatch(/client_balance_ledger/);
    }
    // Only issued/applied notes count — drafts and cancelled are excluded.
    const [cnSql] = db.query.mock.calls[2];
    expect(cnSql).toMatch(/status IN \('issued', 'applied'\)/);
  });

  test('currency: mixed invoice/payment currencies fall back to the org currency', async () => {
    db.query
      .mockResolvedValueOnce([[
        { id: 1, total: '100.00', currency: 'USD', balance_due: '100.00' },
      ]])
      .mockResolvedValueOnce([[
        { amount: '20.00', currency: 'EUR', allocated: '0.00' },
      ]])
      .mockResolvedValueOnce([[]]) // credit notes — none
      .mockResolvedValueOnce([[{ currency: 'MXN' }]]); // Organization.getCurrency fallback

    const { balance, currency } = await computeClientBalance(1, 5);
    expect(balance).toBe(80); // 100 owed - 20 credit, no fake conversion
    expect(currency).toBe('MXN');
  });

  test('currency: zero-contribution balance (nothing owed, nothing unallocated) falls back to the org currency', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]) // credit notes — none
      .mockResolvedValueOnce([[{ currency: 'MXN' }]]);

    const { balance, currency } = await computeClientBalance(1, 5);
    expect(balance).toBe(0);
    expect(currency).toBe('MXN');
  });

  test('a standing credit note alone puts the client in credit; its currency contributes', async () => {
    db.query
      .mockResolvedValueOnce([[]]) // no invoices
      .mockResolvedValueOnce([[]]) // no payments
      .mockResolvedValueOnce([[
        { total: '116.00', currency: 'MXN' },
      ]]);

    const { balance, currency } = await computeClientBalance(1, 35);
    expect(balance).toBe(-116);
    expect(currency).toBe('MXN');
  });
});
