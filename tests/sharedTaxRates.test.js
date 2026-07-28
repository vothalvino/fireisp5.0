'use strict';
// =============================================================================
// FireISP 5.0 — shared (NULL-org) tax rates are visible and read-only (j42)
// =============================================================================
// Migration 121 seeds four rates with organization_id NULL ('applies to all
// tenants'). The resolver's explicit-id branch admits them (#548), but the
// org-scoped list emitted WHERE organization_id = ?, which a NULL row can
// never match — so a rate the resolver would happily apply was invisible and
// unmanageable, and a write attempt 404'd on a row the operator had every
// reason to believe existed.
//
// Both halves now agree: reads admit shared rows (marked is_shared), writes
// refuse them with an explicit 403 — a shared row nobody owns must not be
// deactivatable by one tenant, because that would deactivate it for everybody.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };

const OWN = { id: 5, organization_id: 1, name: 'IVA 16% (walkthrough)', rate: '0.1600', status: 'active', is_shared: 0 };
const SHARED = { id: 3, organization_id: null, name: 'IVA 16% (Mexico)', rate: '0.1600', status: 'active', is_shared: 1 };

function wireDb({ rows = [OWN, SHARED], targetOrg } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: rows.length }]];
    if (/SELECT organization_id FROM tax_rates WHERE id = \?/.test(sql)) {
      return [targetOrg === undefined ? [] : [{ organization_id: targetOrg }]];
    }
    if (/FROM `?tax_rates`?/.test(sql)) return [rows];
    if (/^UPDATE `?tax_rates`?/i.test(sql)) return [{ affectedRows: 1 }];
    if (/^DELETE|^UPDATE.*deleted_at/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const auth = (r) => r.set('Authorization', `Bearer ${token()}`);

beforeEach(() => jest.clearAllMocks());

describe('the list admits shared rows', () => {
  it('queries org rows OR NULL-org rows, and flags shared ones', async () => {
    wireDb();
    const res = await auth(request(app).get('/api/v1/tax-rates'));
    expect(res.status).toBe(200);
    const listSql = db.query.mock.calls.find(c => /FROM tax_rates/.test(c[0]) && /is_shared/.test(c[0]));
    expect(listSql[0]).toMatch(/organization_id = \? OR organization_id IS NULL/);
    expect(listSql[0]).toMatch(/AS is_shared/);
  });

  it('GET /:id resolves a shared row instead of 404ing it', async () => {
    wireDb({ rows: [SHARED] });
    const res = await auth(request(app).get('/api/v1/tax-rates/3'));
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('IVA 16% (Mexico)');
  });

});

describe('writes to a shared row are refused loudly', () => {
  it.each([
    ['PUT', () => auth(request(app).put('/api/v1/tax-rates/3')).send({ name: 'Hijacked' })],
    ['DELETE', () => auth(request(app).delete('/api/v1/tax-rates/3')).send()],
    ['restore', () => auth(request(app).post('/api/v1/tax-rates/3/restore')).send()],
  ])('%s → 403 SHARED_TAX_RATE_READONLY, and nothing is written', async (_verb, go) => {
    wireDb({ targetOrg: null });
    const res = await go();
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SHARED_TAX_RATE_READONLY');
    expect(db.query.mock.calls.some(c => /^UPDATE `?tax_rates`?/i.test(c[0]))).toBe(false);
  });

  it("still allows writes to the org's OWN rates", async () => {
    wireDb({ targetOrg: 1, rows: [OWN] });
    const res = await auth(request(app).put('/api/v1/tax-rates/5')).send({ name: 'Renamed' });
    expect(res.status).not.toBe(403);
  });

});
