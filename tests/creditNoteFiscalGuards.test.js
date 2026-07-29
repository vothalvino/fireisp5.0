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
const { mockTxConnection, txSql, pooledSqlDuringTx } = require('./fixtures/mockTxConnection');
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

beforeEach(() => {
  jest.clearAllMocks();
  // The stand-in USES the executor it is handed, rather than just resolving.
  // The real assertTaxCoherent fans out to clients, tax_rules and organizations,
  // so it is the single biggest nested-acquire risk on this path — and a mock
  // that issues no SQL makes a leak there invisible: reverting the route to
  // db.query left every test green. Now the pool-leak assertion sees it.
  billingService.assertTaxCoherent.mockImplementation(
    async (exec) => { await exec('SELECT id FROM tax_rates WHERE 1=0', []); },
  );
  // Credit-note PUT/PATCH now runs transactionally (j49).
  mockTxConnection(db);
});

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

// =============================================================================
// j49 — the update guards run INSIDE the transaction
// =============================================================================
// Credit-note edits took no row lock at all, so the stamper was not serialized
// against the editor even in principle. Now they do — and every guard read must
// go through the transaction: one left on db.query acquires a SECOND pooled
// connection while the first is held, and enough concurrent edits deadlock the
// pool against itself (the hang fixed in #584).
describe('credit-note updates are check-then-write under a row lock', () => {
  it('locks the row, then runs the CFDI guard on that same connection', async () => {
    const conn = mockTxConnection(db);
    wireDb();
    const res = await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 500, tax_amount: 80, total: 580 });

    expect(res.status).toBe(200);
    expect(conn.beginTransaction).toHaveBeenCalled();
    const tx = txSql(conn);
    const lockAt = tx.findIndex(s => /FOR UPDATE/.test(s));
    const cfdiAt = tx.findIndex(s => /cfdi_documents/i.test(s));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(cfdiAt).toBeGreaterThan(lockAt);
  });

  // BOTH guard branches. The tax-removal one matters most: it is the only
  // path that reaches assertTaxCoherent, whose real implementation fans out to
  // clients, tax_rules and organizations — the biggest nested-acquire risk
  // here. An edit that RAISES tax never calls it, so a leak-check that only
  // sends higher amounts cannot see a leak there at all.
  it.each([
    ['raises tax', { subtotal: 500, tax_amount: 80, total: 580 }],
    ['REMOVES tax (assertTaxCoherent branch)', { subtotal: 580, tax_amount: 0, total: 580 }],
  ])('%s — nothing leaks onto the pool while the transaction is open', async (_label, body) => {
    const conn = mockTxConnection(db);
    wireDb();
    const res = await auth(request(app).put('/api/v1/credit-notes/5')).send(body);

    // Paired with positive assertions: an absence check alone passes trivially
    // when the request never reaches the guard at all.
    expect(res.status).toBe(200);
    expect(txSql(conn).some(s => /cfdi_documents/i.test(s))).toBe(true);
    // audit_logs is ignored because crudController writes it AFTER commit and
    // release — it is legitimately not inside the transaction. The helper
    // diffs totals and cannot tell "during" from "after" on its own.
    expect(pooledSqlDuringTx(db, conn, /`users`|audit_logs/)).toEqual([]);
  });

  it('a live CFDI still blocks the edit, and nothing is written', async () => {
    const conn = mockTxConnection(db);
    wireDb({ liveCfdi: true });
    const res = await auth(request(app).put('/api/v1/credit-notes/5'))
      .send({ subtotal: 500, tax_amount: 80, total: 580 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([s]) => /^UPDATE `?credit_notes`?/i.test(s))).toBe(false);
  });
});

// =============================================================================
// j50 — delete and restore are check-then-write under a row lock too
// =============================================================================
// #586 gave UPDATE the lock; delete and restore were left running their guards
// on a pooled connection. Concrete failure that allowed: support issues DELETE
// /credit-notes/30, the unlocked assertNoLiveCfdi clears, billing stamps the
// note in that window, the stamper commits and the PAC returns a UUID — then
// the DELETE proceeds and soft-deletes a note whose CFDI de Egreso is VIGENTE
// at SAT. cfdi_documents.credit_note_id now points at a deleted row, and only a
// formal cancellation undoes the filing.
describe('credit-note delete and restore hold the row lock', () => {
  it('DELETE locks the row and runs the CFDI guard on that connection', async () => {
    const conn = mockTxConnection(db);
    wireDb();
    const res = await auth(request(app).delete('/api/v1/credit-notes/5')).send();

    expect([200, 204]).toContain(res.status);
    expect(conn.beginTransaction).toHaveBeenCalled();
    const tx = txSql(conn);
    const lockAt = tx.findIndex(s => /FOR UPDATE/.test(s));
    const cfdiAt = tx.findIndex(s => /cfdi_documents/i.test(s));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(cfdiAt).toBeGreaterThan(lockAt);
  });

  it('a live CFDI blocks the DELETE, and nothing is written', async () => {
    const conn = mockTxConnection(db);
    wireDb({ liveCfdi: true });
    const res = await auth(request(app).delete('/api/v1/credit-notes/5')).send();

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CFDI_STAMPED');
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([s]) => /SET deleted_at = NOW\(\)/i.test(s))).toBe(false);
  });

  it('RESTORE runs its guard on the transaction as well', async () => {
    // The row is soft-deleted, so there is no FOR UPDATE fetch to hang the lock
    // on — the guard still has to run on the same connection as the un-delete,
    // or a CFDI stamped in the window is invisible to it.
    const conn = mockTxConnection(db);
    wireDb({ liveCfdi: true });
    const res = await auth(request(app).post('/api/v1/credit-notes/5/restore')).send();

    expect(res.status).toBe(422);
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(txSql(conn).some(s => /cfdi_documents/i.test(s))).toBe(true);
    expect(db.query.mock.calls.some(([s]) => /SET deleted_at = NULL/i.test(s))).toBe(false);
  });

  it('nothing leaks onto the pool during a delete', async () => {
    const conn = mockTxConnection(db);
    wireDb();
    const res = await auth(request(app).delete('/api/v1/credit-notes/5')).send();
    expect([200, 204]).toContain(res.status);
    expect(txSql(conn).some(s => /cfdi_documents/i.test(s))).toBe(true);
    expect(pooledSqlDuringTx(db, conn, /`users`|audit_logs/)).toEqual([]);
  });
});
