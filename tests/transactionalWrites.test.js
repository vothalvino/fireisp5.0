'use strict';
// =============================================================================
// FireISP 5.0 — check-then-write is atomic on guarded updates (j17)
// =============================================================================
// beforeUpdate hooks read on one pooled connection and the UPDATE lands on
// another, so a concurrent writer can slip between them. For invoices that is
// the difference between a guard and a guarantee: an invoice can be stamped
// microseconds after the no-live-CFDI guard cleared it, and the edit then
// applies to a document already filed with SAT.
//
// Two halves are tested here:
//   1. BaseModel accepts an executor + FOR UPDATE, strictly additively — the
//      no-opts path must stay byte-identical, because 171 models use it.
//   2. crudController's transactionalWrites wires fetch/guard/write onto one
//      locked connection, and rolls back when the guard throws.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const db = require('../src/config/database');
const config = require('../src/config');
const { mockTxConnection, txSql, pooledSqlDuringTx } = require('./fixtures/mockTxConnection');
const BaseModel = require('../src/models/BaseModel');
const { crudController } = require('../src/controllers/crudController');
// Required at module scope on purpose: resetModules() inside a test would hand
// the app a DIFFERENT instance of the mocked database module than the `db`
// captured above, so none of the mock implementations would apply.
const realApp = require('../src/app');

class Widget extends BaseModel {
  static get tableName() { return 'widgets'; }
  static get fillable() { return ['name', 'qty']; }
  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

beforeEach(() => { jest.clearAllMocks(); });

// ---------------------------------------------------------------------------
// 1. BaseModel — additive
// ---------------------------------------------------------------------------
describe('BaseModel accepts an executor without changing the default path', () => {
  it('uses db.query and adds NO lock when opts are omitted', async () => {
    db.query.mockResolvedValue([[{ id: 1 }]]);
    await Widget.findById(1, 7);
    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql] = db.query.mock.calls[0];
    // The whole point of "strictly additive": 171 models share this path, and
    // an accidental FOR UPDATE on every read would take row locks app-wide.
    expect(sql).not.toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/organization_id = \?/);
    expect(sql).toMatch(/deleted_at IS NULL/);
  });

  it('routes the read to opts.exec instead of db.query', async () => {
    const exec = jest.fn().mockResolvedValue([[{ id: 1 }]]);
    await Widget.findById(1, 7, { exec });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('appends FOR UPDATE only when asked, AFTER the predicates', async () => {
    const exec = jest.fn().mockResolvedValue([[{ id: 1 }]]);
    await Widget.findById(1, 7, { exec, forUpdate: true });
    const [sql] = exec.mock.calls[0];
    expect(sql).toMatch(/FOR UPDATE$/);
    // A lock clause placed before the WHERE would be a syntax error, so pin
    // the ordering rather than mere presence.
    expect(sql.indexOf('FOR UPDATE')).toBeGreaterThan(sql.indexOf('deleted_at IS NULL'));
  });

  it('update() runs BOTH the write and the read-back on the same executor', async () => {
    // If the read-back fell through to db.query it would use a different
    // pooled connection and could not see the uncommitted row — the caller
    // would get pre-update values back from a successful update.
    const exec = jest.fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 1, name: 'after' }]]);
    const out = await Widget.update(1, { name: 'after' }, 7, { exec });
    expect(exec).toHaveBeenCalledTimes(2);
    expect(db.query).not.toHaveBeenCalled();
    expect(out.name).toBe('after');
    expect(exec.mock.calls[1][0]).not.toMatch(/FOR UPDATE/); // already locked
  });

  it('update() with no fillable fields still honours the executor', async () => {
    // The cols.length === 0 early return is easy to miss when threading opts.
    const exec = jest.fn().mockResolvedValue([[{ id: 1 }]]);
    await Widget.update(1, { not_fillable: 'x' }, 7, { exec });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 2. crudController — the transaction
// ---------------------------------------------------------------------------
describe('crudController transactionalWrites', () => {
  const buildApp = (opts) => {
    const express = require('express');
    const app = express();
    app.use(express.json());
    const ctrl = crudController(Widget, opts);
    app.use((req, _res, next) => { req.orgId = 7; req.user = { id: 1 }; next(); });
    app.put('/w/:id', ctrl.update);
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } }));
    return app;
  };

  it('locks the row, runs the guard on the SAME connection, then commits', async () => {
    const conn = mockTxConnection(db);
    db.query.mockResolvedValue([[{ id: 1, organization_id: 7, name: 'a' }]]);
    const seen = [];
    const app = buildApp({
      transactionalWrites: true,
      beforeUpdate: async (_old, _req, exec) => { seen.push(typeof exec); },
    });

    const res = await request(app).put('/w/1').send({ name: 'b' });
    expect(res.status).toBe(200);
    expect(conn.beginTransaction).toHaveBeenCalled();
    expect(conn.commit).toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    // The guard MUST be handed an executor — a hook that reads related rows
    // without it is still reading outside the lock.
    expect(seen).toEqual(['function']);
    const locked = db.query.mock.calls.find(([s]) => /FOR UPDATE/.test(s));
    expect(locked).toBeDefined();
  });

  it('rolls back and writes nothing when the guard throws', async () => {
    const conn = mockTxConnection(db);
    db.query.mockResolvedValue([[{ id: 1, organization_id: 7 }]]);
    const { AppError } = require('../src/utils/errors');
    const app = buildApp({
      transactionalWrites: true,
      beforeUpdate: async () => { throw new AppError('nope', 422, 'GUARD'); },
    });

    const res = await request(app).put('/w/1').send({ name: 'b' });
    expect(res.status).toBe(422);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(db.query.mock.calls.some(([s]) => /^UPDATE/i.test(s))).toBe(false);
  });

  it('releases the connection even when the update itself fails', async () => {
    // A leaked pooled connection is worse than the bug being fixed: it
    // exhausts the pool and takes the whole app down, not one request.
    const conn = mockTxConnection(db);
    db.query.mockRejectedValue(new Error('boom'));
    const app = buildApp({ transactionalWrites: true });
    const res = await request(app).put('/w/1').send({ name: 'b' });
    expect(res.status).toBe(500);
    expect(conn.release).toHaveBeenCalled();
  });

  it('destroys, rather than releases, a connection whose ROLLBACK failed', async () => {
    // Returning it to the pool would hand the next borrower a connection with
    // an open transaction and its locks still held — the failure spreads to
    // unrelated requests.
    const conn = mockTxConnection(db);
    conn.rollback.mockRejectedValue(new Error('connection wedged'));
    db.query.mockResolvedValue([[{ id: 1, organization_id: 7 }]]);
    const { AppError } = require('../src/utils/errors');
    const app = buildApp({
      transactionalWrites: true,
      beforeUpdate: async () => { throw new AppError('nope', 422, 'GUARD'); },
    });

    const res = await request(app).put('/w/1').send({ name: 'b' });
    expect(res.status).toBe(422);
    expect(conn.destroy).toHaveBeenCalled();
    expect(conn.release).not.toHaveBeenCalled();
  });

  it('a destroy() that itself throws still does not release, and keeps the real error', async () => {
    // If `disposed` were set AFTER the destroy call, a throwing destroy would
    // skip the flag, fall into finally, and release the wedged connection
    // anyway — the exact outcome the destroy branch exists to prevent — while
    // replacing the caller's 422 with an opaque 500.
    const conn = mockTxConnection(db);
    conn.rollback.mockRejectedValue(new Error('connection wedged'));
    conn.destroy.mockImplementation(() => { throw new Error('destroy blew up'); });
    db.query.mockResolvedValue([[{ id: 1, organization_id: 7 }]]);
    const { AppError } = require('../src/utils/errors');
    const app = buildApp({
      transactionalWrites: true,
      beforeUpdate: async () => { throw new AppError('nope', 422, 'GUARD'); },
    });

    const res = await request(app).put('/w/1').send({ name: 'b' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GUARD');
    expect(conn.release).not.toHaveBeenCalled();
  });

  it('without the flag, takes no connection at all — unchanged behaviour', async () => {
    db.query.mockResolvedValue([[{ id: 1, organization_id: 7 }]]);
    const app = buildApp({ beforeUpdate: async () => {} });
    const res = await request(app).put('/w/1').send({ name: 'b' });
    expect(res.status).toBe(200);
    expect(db.getConnection).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([s]) => /FOR UPDATE/.test(s))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. The actual j17 case, end to end through the invoice route
// ---------------------------------------------------------------------------
describe('every guard read runs ON the transaction, never on the pool', () => {
  const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 7 }, config.jwt.secret, { expiresIn: '1h' });
  const INVOICE = {
    id: 5, organization_id: 7, client_id: 3, status: 'issued',
    subtotal: '100.00', tax_amount: '16.00', total: '116.00', tax_rate: '0.1600',
  };

  const wire = () => db.query.mockImplementation(async (sql) => {
    if (/`users`/.test(sql)) return [[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 7 }]];
    // BaseModel backticks the table name, so a dispatcher written as
    // /FROM invoices WHERE id/ silently matches nothing and the route 404s.
    if (/FROM `?invoices`?\s+WHERE id/.test(sql)) return [[INVOICE]];
    if (/cfdi_documents/i.test(sql)) return [[]];            // no live CFDI
    if (/FROM clients/i.test(sql)) return [[{ id: 3, tax_exempt: 0 }]];
    if (/^UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });

  const patch = (body) => request(realApp)
    .patch('/api/v1/invoices/5')
    .set('Authorization', `Bearer ${token()}`)
    .send(body);

  it('takes the lock before the CFDI check, and the check runs on the tx', async () => {
    const conn = mockTxConnection(db);
    wire();
    const res = await patch({ subtotal: 200, tax_amount: 32, total: 232 });
    expect([200, 422]).toContain(res.status);

    expect(conn.beginTransaction).toHaveBeenCalled();
    const tx = txSql(conn);
    const lockAt = tx.findIndex(s => /FOR UPDATE/.test(s));
    const cfdiAt = tx.findIndex(s => /cfdi_documents/i.test(s));
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(cfdiAt).toBeGreaterThan(lockAt);
  });

  // THE regression guard. Every statement between BEGIN and COMMIT must run on
  // the checked-out connection. One left on db.query acquires a SECOND
  // connection from the same pool while holding the first; with
  // waitForConnections and no acquire timeout, enough concurrent edits
  // deadlock the pool against itself and the process hangs until restarted.
  // The earlier version of this fixture could not see this at all.
  it.each([
    ['raises tax (exempt-client branch)', { subtotal: 200, tax_amount: 32, total: 232 }],
    ['REMOVES tax (assertTaxCoherent branch)', { tax_amount: 0, total: 100 }],
    ['changes client (ownership branch)', { client_id: 9 }],
  ])('%s — nothing leaks onto the pool', async (_label, body) => {
    const conn = mockTxConnection(db);
    wire();
    const res = await patch(body);
    // Without these two, the assertion below passes VACUOUSLY: a request that
    // 404s before reaching the guard runs no pooled SQL either. Breaking the
    // dispatcher regex is enough to trigger exactly that.
    expect(res.status).toBe(200);
    expect(txSql(conn).some(s => /cfdi_documents/i.test(s))).toBe(true);
    expect(pooledSqlDuringTx(db, conn)).toEqual([]);
  });
});
