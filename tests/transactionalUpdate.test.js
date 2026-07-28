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
//   2. crudController's transactionalUpdate wires fetch/guard/write onto one
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
const { mockTxConnection } = require('./fixtures/mockTxConnection');
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
describe('crudController transactionalUpdate', () => {
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
      transactionalUpdate: true,
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
      transactionalUpdate: true,
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
    const app = buildApp({ transactionalUpdate: true });
    const res = await request(app).put('/w/1').send({ name: 'b' });
    expect(res.status).toBe(500);
    expect(conn.release).toHaveBeenCalled();
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
describe('the invoice fiscal guard now reads inside the lock', () => {
  const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 7 }, config.jwt.secret, { expiresIn: '1h' });

  it('the no-live-CFDI check runs on the transaction, not a pooled connection', async () => {
    const conn = mockTxConnection(db);
    const INVOICE = {
      id: 5, organization_id: 7, client_id: 3, status: 'issued',
      subtotal: '100.00', tax_amount: '16.00', total: '116.00', tax_rate: '0.1600',
    };
    db.query.mockImplementation(async (sql) => {
      if (/`users`/.test(sql)) return [[{ id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 7 }]];
      // BaseModel backticks the table name, so a dispatcher written as
      // /FROM invoices WHERE id/ silently matches nothing and the route 404s.
      if (/FROM `?invoices`?\s+WHERE id/.test(sql)) return [[INVOICE]];
      if (/cfdi_documents/i.test(sql)) return [[]];           // no live CFDI
      if (/^UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
      return [[]];
    });

    const res = await request(realApp)
      .patch('/api/v1/invoices/5')
      .set('Authorization', `Bearer ${token()}`)
      .send({ subtotal: 200, tax_amount: 32, total: 232 });

    expect([200, 422]).toContain(res.status);
    // The CFDI lookup must have gone through the transaction. Because the mock
    // connection delegates to db.query we cannot tell them apart by target, so
    // assert the lock was taken and the CFDI read happened within it.
    const sqls = db.query.mock.calls.map(([s]) => s);
    expect(sqls.some(s => /FOR UPDATE/.test(s))).toBe(true);
    expect(conn.beginTransaction).toHaveBeenCalled();
    const lockAt = sqls.findIndex(s => /FOR UPDATE/.test(s));
    const cfdiAt = sqls.findIndex(s => /cfdi_documents/i.test(s));
    expect(cfdiAt).toBeGreaterThan(lockAt);
  });
});
