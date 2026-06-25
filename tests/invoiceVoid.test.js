// =============================================================================
// FireISP 5.0 — Invoice void: balance-ledger reversal + paid-invoice guard
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
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

jest.mock('../src/models/Invoice', () => ({
  findByIdOrFail: jest.fn(),
  update: jest.fn(),
}));

const db = require('../src/config/database');
const Invoice = require('../src/models/Invoice');
const app = require('../src/app');

const ledgerInsert = () => db.query.mock.calls.find(c => /INSERT INTO client_balance_ledger/.test(c[0]));

beforeEach(() => { jest.clearAllMocks(); });

describe('PATCH /invoices/:id — void', () => {
  it('rejects voiding a PAID invoice with 422 and writes nothing', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'paid', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_PAID');
    expect(Invoice.update).not.toHaveBeenCalled();
    expect(ledgerInsert()).toBeFalsy();
  });

  it('voids an issued invoice and reverses the outstanding ledger debit (credit entry)', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'issued', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'void', client_id: 9 });
    db.query
      .mockResolvedValueOnce([[{ net: 100 }]]) // SELECT net signed contribution
      .mockResolvedValueOnce([{ insertId: 1 }]); // INSERT reversal credit
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('void');
    const ins = ledgerInsert();
    expect(ins).toBeTruthy();
    expect(ins[0]).toMatch(/'credit'/);
    expect(ins[1]).toEqual(expect.arrayContaining([9, 1, 100])); // client_id, org_id, reverse amount
  });

  it('does not reverse when the invoice has no outstanding ledger debit (idempotent / never debited)', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'issued', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'void' });
    db.query.mockResolvedValueOnce([[{ net: 0 }]]);
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(ledgerInsert()).toBeFalsy();
  });

  it('skips reversal when the invoice is already void (no double credit)', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 5, status: 'void', client_id: 9, invoice_number: 'INV-5', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 5, status: 'void' });
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'void' });
    expect(res.status).toBe(200);
    expect(db.query).not.toHaveBeenCalled();
    expect(ledgerInsert()).toBeFalsy();
  });

  it('a non-void PATCH still goes through the generic update path', async () => {
    Invoice.update.mockResolvedValue({ id: 5, status: 'overdue' });
    const res = await request(app).patch('/api/v1/invoices/5').send({ status: 'overdue' });
    expect(res.status).toBe(200);
    expect(ledgerInsert()).toBeFalsy();
  });
});

describe('PUT /invoices/:id — void (InvoiceDetail path)', () => {
  it('rejects voiding a PAID invoice with 422', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 7, status: 'paid', client_id: 3, invoice_number: 'INV-7', currency: 'USD' });
    const res = await request(app).put('/api/v1/invoices/7').send({ status: 'void' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_PAID');
  });

  it('reverses the ledger on a PUT void', async () => {
    Invoice.findByIdOrFail.mockResolvedValue({ id: 7, status: 'issued', client_id: 3, invoice_number: 'INV-7', currency: 'USD' });
    Invoice.update.mockResolvedValue({ id: 7, status: 'void' });
    db.query
      .mockResolvedValueOnce([[{ net: 50 }]])
      .mockResolvedValueOnce([{ insertId: 2 }]);
    const res = await request(app).put('/api/v1/invoices/7').send({ status: 'void' });
    expect(res.status).toBe(200);
    const ins = ledgerInsert();
    expect(ins).toBeTruthy();
    expect(ins[1]).toEqual(expect.arrayContaining([3, 1, 50]));
  });
});
