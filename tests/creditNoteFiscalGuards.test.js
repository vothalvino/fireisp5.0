'use strict';
// =============================================================================
// FireISP 5.0 — credit notes get the fiscal guards invoices already had
// =============================================================================
// Two holes, both the tipo-E twin of one already closed for invoices:
//
//   * CREATE and UPDATE never consulted the tax resolver. A credit note for a
//     non-exempt MX client with tax 0 satisfied the only check there was
//     (subtotal + tax = total) and stamped as a CFDI de Egreso with
//     ObjetoImp='01' and no impuestos — declaring the credited operation was
//     not taxable, while the ingreso it relates to (TipoRelacion 01) declared
//     IVA on the same money. Same defect as #549/#551, different document.
//
//   * UPDATE, DELETE and RESTORE had no live-CFDI guard, so a stamped credit
//     note's row could be edited or soft-deleted while the egreso stayed filed
//     at SAT. That is #532 and #550, for credit notes.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/billingService', () => ({
  // MUST list every export the route calls. A partial service mock turns a new
  // call site into "undefined is not a function" — a 500 on every create rather
  // than a visible missing-guard failure (#550, and again in #551).
  assertTaxCoherent: jest.fn().mockResolvedValue(undefined),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const billingService = require('../src/services/billingService');
const { AppError } = require('../src/utils/errors');
const app = require('../src/app');

const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);
const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };

const STORED = {
  id: 5, organization_id: 1, client_id: 9, invoice_id: 7, credit_note_number: 'CN-0001',
  subtotal: '1000.00', tax_amount: '160.00', total: '1160.00', tax_rate: '0.1600', currency: 'MXN',
};

function wireDb({ liveCfdi = false, stored = STORED } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/FROM cfdi_documents/.test(sql)) return [liveCfdi ? [{ id: 31, sat_status: 'vigente' }] : []];
    if (/FROM `?credit_notes`?/.test(sql)) return [[stored]];
    if (/INSERT INTO `?credit_notes`?/.test(sql)) return [{ insertId: 5 }];
    if (/^UPDATE `?credit_notes`?/i.test(sql)) return [{ affectedRows: 1 }];
    if (/INSERT INTO client_balance_ledger/.test(sql)) return [{ insertId: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

beforeEach(() => { jest.clearAllMocks(); billingService.assertTaxCoherent.mockResolvedValue(undefined); });

describe('create consults the tax resolver', () => {
  it('passes the tax figure that is about to be written', async () => {
    wireDb();
    await auth(request(app).post('/api/v1/credit-notes'))
      .send({ client_id: 9, subtotal: 1000, tax_amount: 160, total: 1160 });
    expect(billingService.assertTaxCoherent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ clientId: 9, taxAmount: 160, docType: 'credit note' }),
    );
  });

  it('treats a missing tax_amount as zero, not as "no opinion"', async () => {
    // The exact shape of the bug: {subtotal: 1160, total: 1160} with no tax.
    wireDb();
    await auth(request(app).post('/api/v1/credit-notes'))
      .send({ client_id: 9, subtotal: 1160, total: 1160 });
    expect(billingService.assertTaxCoherent).toHaveBeenCalledWith(
      expect.any(Function), expect.objectContaining({ taxAmount: 0 }),
    );
  });

  it('propagates the guard 422 and writes nothing', async () => {
    wireDb();
    billingService.assertTaxCoherent.mockRejectedValueOnce(
      new AppError('This credit note carries no tax, but 16% applies to this client.', 422, 'TAX_REQUIRED'),
    );
    const res = await auth(request(app).post('/api/v1/credit-notes'))
      .send({ client_id: 9, subtotal: 1160, total: 1160 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TAX_REQUIRED');
    expect(db.query.mock.calls.some(c => /INSERT INTO `?credit_notes`?/.test(c[0]))).toBe(false);
    // The balance ledger must not move either — a credit note that was rejected
    // has not credited anybody.
    expect(db.query.mock.calls.some(c => /INSERT INTO client_balance_ledger/.test(c[0]))).toBe(false);
  });
});

describe('a live CFDI freezes the credit note', () => {
  it('blocks an amount edit', async () => {
    wireDb({ liveCfdi: true });
    const res = await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 500, tax_amount: 80, total: 580 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
    expect(db.query.mock.calls.some(c => /^UPDATE `?credit_notes`?/i.test(c[0]))).toBe(false);
  });

  it('blocks a delete', async () => {
    wireDb({ liveCfdi: true });
    const res = await auth(request(app).delete('/api/v1/credit-notes/5')).send();
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
  });

  it('allows an edit that touches no frozen field', async () => {
    // The edit modal re-sends amounts on every save, so the guard compares by
    // VALUE. A notes-only edit on a stamped note must still work.
    wireDb({ liveCfdi: true });
    const res = await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ notes: 'called the client' });
    expect(res.status).not.toBe(422);
  });

  it('allows re-sending identical amounts', async () => {
    wireDb({ liveCfdi: true });
    const res = await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 1000, tax_amount: 160, total: 1160, notes: 'x' });
    expect(res.status).not.toBe(422);
  });

  it('allows the same edits when there is NO live CFDI', async () => {
    wireDb({ liveCfdi: false });
    const res = await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 500, tax_amount: 80, total: 580 });
    expect(res.status).not.toBe(422);
  });
});

describe('an edit cannot strip the tax off a credit note', () => {
  it('consults the resolver when the edit removes tax', async () => {
    wireDb();
    await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 1160, tax_amount: 0, total: 1160 });
    expect(billingService.assertTaxCoherent).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ taxAmount: 0, docType: 'credit note' }),
    );
  });

  it('does NOT consult it when the note was already untaxed', async () => {
    // Going-forward-only: a legacy zero-tax note must stay editable.
    wireDb({ stored: { ...STORED, tax_amount: '0.00', total: '1000.00', tax_rate: '0.0000' } });
    await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 900, tax_amount: 0, total: 900 });
    expect(billingService.assertTaxCoherent).not.toHaveBeenCalled();
  });

  it('does NOT consult it when the edit leaves tax in place', async () => {
    wireDb();
    await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 500, tax_amount: 80, total: 580 });
    expect(billingService.assertTaxCoherent).not.toHaveBeenCalled();
  });
});
