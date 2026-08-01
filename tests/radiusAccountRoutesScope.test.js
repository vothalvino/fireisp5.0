'use strict';
// =============================================================================
// FireISP 5.0 — per-account Framed-Routes are org-scoped
// =============================================================================
// All four verbs on /radius/:id/routes took the account id straight from the
// URL and queried radius_account_routes with no org predicate:
//
//   GET    WHERE radius_account_id = ?                 -> cross-tenant read
//   POST   INSERT stamped req.orgId, PARENT unchecked  -> inject onto another
//                                                          tenant's account
//   PUT    WHERE id = ? AND radius_account_id = ?      -> cross-tenant write
//   DELETE same shape                                  -> cross-tenant delete
//
// The write side is the serious half, and it is not a data problem.
// radiusService consumes these rows at AUTHENTICATION time to emit
// Framed-Route, so a route injected onto another tenant's account changes where
// that subscriber's traffic actually goes.
//
// The POST stamping req.orgId made it worse rather than better: the row looked
// correctly owned while hanging off someone else's account, so an audit of
// radius_account_routes.organization_id would have shown nothing wrong.
//
// Found by a systematic sweep for raw SELECTs on org-owning tables keyed on a
// parent id — 74 candidates, of which the overwhelming majority are safe
// because the key comes from an already-validated parent (the portal binds
// req.client) rather than from the request.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(), off: jest.fn(), once: jest.fn(), removeListener: jest.fn(),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };
const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);

const ROUTE = { id: 9, radius_account_id: 5, organization_id: 1, destination: '10.0.0.0/24' };

function wire({ accountVisible = true, affected = 1 } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[ADMIN]];
    if (/FROM `?radius`?\s/i.test(sql) || /FROM `?radius`? WHERE/i.test(sql)) {
      return [accountVisible ? [{ id: 5, organization_id: 1 }] : []];
    }
    if (/^INSERT INTO radius_account_routes/.test(sql)) return [{ insertId: 9, affectedRows: 1 }];
    if (/^UPDATE radius_account_routes/.test(sql)) return [{ affectedRows: affected }];
    if (/FROM radius_account_routes/.test(sql)) return [[ROUTE]];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const routeQueries = () => db.query.mock.calls.filter(([s]) => /radius_account_routes/.test(s));
const BASE = '/api/v1/radius/5/routes';

beforeEach(() => { jest.clearAllMocks(); wire(); });

describe('the parent account is proven to be the caller\'s', () => {
  it.each([
    ['get', BASE],
    ['post', BASE],
    ['put', `${BASE}/9`],
    ['delete', `${BASE}/9`],
  ])('%s checks the account before touching routes', async (method, url) => {
    wire({ accountVisible: false });
    const res = await auth(request(app)[method](url)).send({ destination: '10.0.0.0/24' });
    expect(res.status).toBe(404);
    // Nothing about routes should have been read OR written.
    expect(routeQueries()).toHaveLength(0);
  });
});

describe('every route query carries an org predicate', () => {
  it('GET is scoped', async () => {
    await auth(request(app).get(BASE));
    const q = routeQueries()[0];
    expect(q[0]).toMatch(/organization_id = \?/);
    expect(q[1]).toEqual(['5', 1, 1]);
  });

  it('PUT is scoped — this wrote across tenants before', async () => {
    await auth(request(app).put(`${BASE}/9`)).send({ destination: '10.0.0.0/24' });
    const upd = routeQueries().find(([s]) => /^UPDATE radius_account_routes SET destination/.test(s));
    expect(upd).toBeDefined();
    expect(upd[0]).toMatch(/organization_id = \?/);
  });

  it('DELETE is scoped', async () => {
    await auth(request(app).delete(`${BASE}/9`));
    const del = routeQueries().find(([s]) => /^UPDATE radius_account_routes SET deleted_at/.test(s));
    expect(del).toBeDefined();
    expect(del[0]).toMatch(/organization_id = \?/);
  });

  it('admits NULL-org rows so single-tenant installs still work', async () => {
    await auth(request(app).get(BASE));
    expect(routeQueries()[0][0]).toMatch(/\? IS NULL AND organization_id IS NULL/);
  });
});

describe('a rejected write does not report success', () => {
  it('PUT 404s when the UPDATE matched nothing', async () => {
    // The old version re-read the row with `WHERE id = ?` afterwards, so a
    // rejected UPDATE still returned another tenant's route as though it had
    // been edited — a write that failed, reported as a write that worked.
    wire({ affected: 0 });
    const res = await auth(request(app).put(`${BASE}/9`)).send({ destination: '10.0.0.0/24' });
    expect(res.status).toBe(404);
  });

  it('DELETE 404s when nothing was deleted', async () => {
    wire({ affected: 0 });
    const res = await auth(request(app).delete(`${BASE}/9`));
    expect(res.status).toBe(404);
  });
});

describe('legitimate use is unaffected', () => {
  it('lists routes for an account the caller owns', async () => {
    const res = await auth(request(app).get(BASE));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('creates a route on an owned account, stamping the org', async () => {
    const res = await auth(request(app).post(BASE)).send({ destination: '10.0.0.0/24' });
    expect(res.status).toBe(201);
    const ins = routeQueries().find(([s]) => /^INSERT INTO radius_account_routes/.test(s));
    expect(ins[1]).toContain(1);
  });
});
