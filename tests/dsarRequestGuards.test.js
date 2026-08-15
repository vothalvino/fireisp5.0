'use strict';
// =============================================================================
// FireISP 5.0 — DSAR routes get the guards the consent routes got (j46)
// =============================================================================
// POST /dsar-requests had the same two holes /consent had before #562:
//
//   * No validation schema, so an invalid request_type went straight at the
//     ENUM column and 500'd, and a missing client_id inserted NULL into a
//     NOT NULL column.
//   * No client-org check, so a staff user could open a data-rights request
//     against ANOTHER tenant's client.
//
// Migration 432 also grants billing `.manage`, which is what makes the fulfil
// and reject routes reachable by the role the page is scoped to. Those routes
// take only an optional note, now validated.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
  withPrimaryContext: callback => callback(),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };

const insertOf = () => db.query.mock.calls.find(c => /INSERT INTO dsar_requests/.test(c[0]));

function wireDb({ clientInOrg = true } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/FROM organizations/.test(sql)) return [[{ id: 1, name: 'Test org' }]];
    if (/FROM organization_users/.test(sql) && /membership_role/.test(sql)) {
      return [[{ membership_role: 'admin' }]];
    }
    if (/SELECT u\.id, u\.email, u\.role/.test(sql)) {
      return [[{ ...ADMIN, authority_persona: 'admin', is_install_operator: 0 }]];
    }
    if (/SELECT g\.id AS group_id/.test(sql)) return [[{ group_id: 1, has_access: 1 }]];
    if (/FROM role_permissions rp/.test(sql)) {
      return [[
        { slug: 'dsar_requests.view' },
        { slug: 'dsar_requests.create' },
        { slug: 'dsar_requests.manage' },
      ]];
    }
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/FROM clients WHERE id = \? AND organization_id <=> \?/.test(sql)) {
      return [clientInOrg ? [{ id: 42 }] : []];
    }
    if (/INSERT INTO dsar_requests/.test(sql)) return [{ insertId: 8 }];
    if (/^UPDATE dsar_requests/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
}

const post = (body) => request(app)
  .post('/api/v1/regulatory-compliance/dsar-requests')
  .set('Authorization', `Bearer ${token()}`)
  .send(body);

const GOOD = { client_id: 42, request_type: 'access' };

beforeEach(() => jest.clearAllMocks());

describe('POST /dsar-requests is validated', () => {
  it('logs a valid request with the 30-day statutory deadline', async () => {
    wireDb();
    const res = await post({ ...GOOD, notes: 'phoned in' });
    expect(res.status).toBe(201);
    // due_at is set by the statement, not the caller — the clock is not optional.
    expect(insertOf()[0]).toMatch(/DATE_ADD\(NOW\(\), INTERVAL 30 DAY\)/);
    expect(insertOf()[1]).toEqual(expect.arrayContaining([42, 'access']));
  });

  it.each(['nonsense', '', 'ACCESS'])('422s request_type %p instead of 500ing on the ENUM', async (rt) => {
    wireDb();
    const res = await post({ ...GOOD, request_type: rt });
    expect(res.status).toBe(422);
    expect(insertOf()).toBeUndefined();
  });

  it('422s a missing client_id instead of inserting NULL', async () => {
    wireDb();
    expect((await post({ request_type: 'access' })).status).toBe(422);
    expect(insertOf()).toBeUndefined();
  });

  it('accepts every type the ENUM allows', async () => {
    for (const rt of ['access', 'erasure', 'portability', 'rectification', 'restriction']) {
      jest.clearAllMocks();
      wireDb();
      expect((await post({ ...GOOD, request_type: rt })).status).toBe(201);
    }
  });
});

describe('a DSAR cannot be opened against another org’s client', () => {
  it('404s and writes nothing', async () => {
    wireDb({ clientInOrg: false });
    const res = await post(GOOD);
    expect(res.status).toBe(404);
    expect(insertOf()).toBeUndefined();
  });
});

describe('fulfill / reject validate their note', () => {
  it.each(['fulfill', 'reject'])('%s accepts an optional note', async (verb) => {
    wireDb();
    const res = await request(app)
      .put(`/api/v1/regulatory-compliance/dsar-requests/8/${verb}`)
      .set('Authorization', `Bearer ${token()}`)
      .send({ notes: 'done' });
    expect(res.status).toBe(200);
  });

  it('rejects an over-long note rather than truncating it silently', async () => {
    wireDb();
    const res = await request(app)
      .put('/api/v1/regulatory-compliance/dsar-requests/8/fulfill')
      .set('Authorization', `Bearer ${token()}`)
      .send({ notes: 'x'.repeat(2001) });
    expect(res.status).toBe(422);
  });
});

describe('migration 432 grants billing .manage on both', () => {
  // The grant is what makes the page usable by the role it is scoped to; a
  // typo'd permission name would seed nothing and silently 403 forever.
  const mig = fs.readFileSync(
    path.join(__dirname, '..', 'database/migrations/432_billing_manages_consents_and_dsars.sql'), 'utf8');

  it('names both permissions exactly as migration 321 seeded them', () => {
    expect(mig).toMatch(/'subscriber_consents\.manage'/);
    expect(mig).toMatch(/'dsar_requests\.manage'/);
    const seed = fs.readFileSync(
      path.join(__dirname, '..', 'database/migrations/321_seed_sec16_permissions.sql'), 'utf8');
    expect(seed).toMatch(/'subscriber_consents\.manage'/);
    expect(seed).toMatch(/'dsar_requests\.manage'/);
  });

  it('targets the billing role and is idempotent', () => {
    expect(mig).toMatch(/WHERE r\.name = 'billing'/);
    expect(mig).toMatch(/NOT EXISTS/);
  });

  it('has a rollback that removes exactly those two grants', () => {
    const rb = fs.readFileSync(
      path.join(__dirname, '..', 'database/rollbacks/432_billing_manages_consents_and_dsars.sql'), 'utf8');
    expect(rb).toMatch(/DELETE rp FROM role_permissions rp/);
    expect(rb).toMatch(/'subscriber_consents\.manage', 'dsar_requests\.manage'/);
    expect(rb).toMatch(/r\.name = 'billing'/);
  });
});
