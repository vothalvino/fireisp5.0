// =============================================================================
// FireISP 5.0 — Invoice composite create (invoice + items, one transaction)
// =============================================================================
// Regression coverage for the two live-hit raw-API bugs: invoice_number is
// NOT NULL in the DB but was never auto-generated (raw 500), and `items` was
// silently dropped (validate() ignores undeclared fields; fillable strips
// them) — a "successful" create yielded a hollow invoice whose later CFDI
// conversion would have no conceptos.
// =============================================================================

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 8, role: 'admin' }; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 5; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/billingService', () => ({
  nextInvoiceNumber: jest.fn().mockResolvedValue('INV-000042'),
  // real normalization — the route depends on it for tax handling
  invoiceTaxFraction: (r) => { const n = parseFloat(r) || 0; return n > 1 ? n / 100 : n; },
}));
jest.mock('../src/models/Organization', () => ({
  getCurrency: jest.fn().mockResolvedValue('MXN'),
}));

const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const app = require('../src/app');

let lastConn;
function wireDb() {
  lastConn = {
    beginTransaction: jest.fn(), commit: jest.fn(), rollback: jest.fn(), release: jest.fn(),
    execute: jest.fn(async (sql) => {
      if (/INSERT INTO invoices/.test(sql)) return [{ insertId: 900 }];
      return [{ affectedRows: 1 }];
    }),
  };
  db.getConnection.mockResolvedValue(lastConn);
  db.query.mockImplementation(async (sql) => {
    if (/SELECT \* FROM invoices WHERE id/.test(sql)) {
      return [[{ id: 900, invoice_number: 'INV-000042', status: 'issued', total: '116.00' }]];
    }
    return [[]];
  });
}

const BASE = {
  client_id: 42, due_date: '2026-08-15',
  subtotal: 100, tax_rate: 0.16, tax_amount: 16, total: 116, status: 'issued',
};

beforeEach(() => { jest.clearAllMocks(); wireDb(); });

describe('POST /api/v1/invoices (composite create)', () => {
  test('auto-numbers when invoice_number is absent and inserts items atomically', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .send({ ...BASE, items: [{ description: 'Internet Hogar 100 Mbps — agosto 2026', quantity: 1, unit_price: 100, amount: 100 }] });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(900);
    expect(billingService.nextInvoiceNumber).toHaveBeenCalledWith(lastConn, 5);
    const invIns = lastConn.execute.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));
    expect(invIns[1]).toEqual(expect.arrayContaining(['INV-000042', 42]));
    // NOT NULL DEFAULT columns must never receive an explicit NULL (live-500;
    // nullable columns like contract_id may legitimately bind NULL)
    const [, , , , , taxRate, , , currency] = invIns[1];
    expect(taxRate).toBeCloseTo(0.16, 6);  // normalized fraction, never NULL
    expect(currency).toBe('MXN');          // absent currency → org currency, never NULL/'USD' 
    const itemIns = lastConn.execute.mock.calls.filter(c => /INSERT INTO invoice_items/.test(c[0]));
    expect(itemIns).toHaveLength(1);
    expect(itemIns[0][1]).toEqual([900, 'Internet Hogar 100 Mbps — agosto 2026', 1, 100, 100]);
    expect(lastConn.commit).toHaveBeenCalled();
  });

  test('a caller-supplied invoice_number is used verbatim (no auto-number)', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .send({ ...BASE, invoice_number: 'CUSTOM-1' });
    expect(res.status).toBe(201);
    expect(billingService.nextInvoiceNumber).not.toHaveBeenCalled();
    const invIns = lastConn.execute.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));
    expect(invIns[1]).toContain('CUSTOM-1');
  });

  test('items that contradict the subtotal are rejected (422 ITEMS_SUBTOTAL_MISMATCH)', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .send({ ...BASE, items: [{ description: 'x', quantity: 1, unit_price: 40, amount: 40 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEMS_SUBTOTAL_MISMATCH');
    expect(lastConn.commit).not.toHaveBeenCalled();
  });

  test('malformed items are rejected with field-level messages, nothing written', async () => {
    for (const items of [
      'not-an-array',
      [{ quantity: 1, unit_price: 10 }],                      // missing description
      [{ description: 'x', quantity: -1, unit_price: 10 }],   // bad quantity
      [{ description: 'x', quantity: 1, unit_price: 'free' }], // bad price
    ]) {
      lastConn.commit.mockClear();
      const res = await request(app).post('/api/v1/invoices').send({ ...BASE, items });
      expect(res.status).toBe(422);
      expect(lastConn.commit).not.toHaveBeenCalled();
    }
  });

  test('amount defaults to quantity × unit_price when omitted', async () => {
    const res = await request(app)
      .post('/api/v1/invoices')
      .send({ ...BASE, items: [{ description: 'x', quantity: 2, unit_price: 50 }] });
    expect(res.status).toBe(201);
    const itemIns = lastConn.execute.mock.calls.find(c => /INSERT INTO invoice_items/.test(c[0]));
    expect(itemIns[1][4]).toBe(100);
  });

  test('an item insert failure rolls back the whole invoice', async () => {
    lastConn.execute.mockImplementation(async (sql) => {
      if (/INSERT INTO invoices/.test(sql)) return [{ insertId: 900 }];
      if (/INSERT INTO invoice_items/.test(sql)) throw new Error('boom');
      return [{ affectedRows: 1 }];
    });
    const res = await request(app)
      .post('/api/v1/invoices')
      .send({ ...BASE, items: [{ description: 'x', quantity: 1, unit_price: 100, amount: 100 }] });
    expect(res.status).toBe(500);
    expect(lastConn.rollback).toHaveBeenCalled();
    expect(lastConn.commit).not.toHaveBeenCalled();
  });

  test('rejects a taxed invoice for an IVA-exempt client (422 CLIENT_TAX_EXEMPT)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/FROM clients/.test(sql)) return [[{ tax_exempt: 1 }]];
      if (/SELECT \* FROM invoices WHERE id/.test(sql)) return [[{ id: 900 }]];
      return [[]];
    });
    // BASE carries tax_amount 16 (> 0) for an exempt client → rejected before any write.
    const res = await request(app).post('/api/v1/invoices').send({ ...BASE });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CLIENT_TAX_EXEMPT');
    expect(lastConn.commit).not.toHaveBeenCalled();
  });

  test('itemless create still works (plain invoice)', async () => {
    const res = await request(app).post('/api/v1/invoices').send(BASE);
    expect(res.status).toBe(201);
    expect(lastConn.execute.mock.calls.some(c => /INSERT INTO invoice_items/.test(c[0]))).toBe(false);
  });
});

describe('POST /api/v1/invoices — tax consistency (live-caught CFDI40119 class)', () => {
  beforeEach(() => { jest.clearAllMocks(); wireDb(); });

  test('normalizes a PERCENT tax_rate to the DECIMAL(5,4) fraction (16 → 0.16), never overflows', async () => {
    const res = await request(app).post('/api/v1/invoices')
      .send({ ...BASE, tax_rate: 16 });   // percent, would overflow the column raw
    expect(res.status).toBe(201);
    const invIns = lastConn.execute.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));
    expect(invIns[1][5]).toBeCloseTo(0.16, 6);   // stored as a fraction
  });

  test('derives tax_rate from tax_amount when only the amount is sent', async () => {
    const res = await request(app).post('/api/v1/invoices')
      .send({ client_id: 42, due_date: '2026-08-15', subtotal: 100, tax_amount: 16, total: 116, status: 'issued' });
    expect(res.status).toBe(201);
    const invIns = lastConn.execute.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));
    expect(invIns[1][5]).toBeCloseTo(0.16, 6);
  });

  test('422 TAX_INCONSISTENT when tax_amount contradicts subtotal × rate', async () => {
    const res = await request(app).post('/api/v1/invoices')
      .send({ client_id: 42, due_date: '2026-08-15', subtotal: 100, tax_rate: 0.16, tax_amount: 5, total: 105, status: 'issued' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TAX_INCONSISTENT');
    expect(lastConn.commit).not.toHaveBeenCalled();
  });

  test('422 TOTAL_INCONSISTENT when total ≠ subtotal + tax', async () => {
    const res = await request(app).post('/api/v1/invoices')
      .send({ client_id: 42, due_date: '2026-08-15', subtotal: 100, tax_rate: 0.16, tax_amount: 16, total: 999, status: 'issued' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TOTAL_INCONSISTENT');
  });

  test('a zero-tax invoice (subtotal == total) is accepted', async () => {
    const res = await request(app).post('/api/v1/invoices')
      .send({ client_id: 42, due_date: '2026-08-15', subtotal: 100, total: 100, status: 'issued' });
    expect(res.status).toBe(201);
    const invIns = lastConn.execute.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));
    expect(invIns[1][5]).toBe(0);
    expect(invIns[1][6]).toBe(0);
  });
});

describe('GET /api/v1/invoices?status=overdue (derived, not a stored status)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('resolves overdue to the derived condition and marks rows overdue', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/COUNT\(\*\)/.test(sql)) return [[{ total: 1 }]];
      if (/SELECT \* FROM invoices/.test(sql)) return [[{ id: 9, invoice_number: 'INV-000218', status: 'issued', due_date: '2026-07-01' }]];
      return [[]];
    });
    const res = await request(app).get('/api/v1/invoices?status=overdue');
    expect(res.status).toBe(200);
    // derived WHERE, not a literal status match
    const selectCall = db.query.mock.calls.find(c => /SELECT \* FROM invoices/.test(c[0]));
    expect(selectCall[0]).toMatch(/status IN \('issued', 'sent', 'overdue'\)/);
    expect(selectCall[0]).toMatch(/due_date < NOW\(\)/);
    // the past-due 'issued' row is presented as overdue
    expect(res.body.data[0].status).toBe('overdue');
    expect(res.body.meta.total).toBe(1);
  });

  test('a non-overdue status still uses the generic list (literal filter)', async () => {
    db.query.mockImplementation(async (sql) => (/COUNT\(\*\)/.test(sql) ? [[{ total: 0 }]] : [[]]));
    const res = await request(app).get('/api/v1/invoices?status=paid');
    expect(res.status).toBe(200);
    const anyDerived = db.query.mock.calls.some(c => /status IN \('issued', 'sent', 'overdue'\)/.test(c[0]));
    expect(anyDerived).toBe(false);
  });
});
