'use strict';
// =============================================================================
// FireISP 5.0 — speed_tests are org-scoped, and POST works at all (j36)
// =============================================================================
// SpeedTest declared hasOrgScope = false and BaseModel omits the org predicate
// SILENTLY when it does, so every verb behind the generic crudController ran
// unscoped: GET /speed-tests returned every measurement on the install
// (client_id, contract_id, observed public ip_address, technician notes,
// throughput history), and PUT/DELETE let any tenant rewrite or destroy
// another tenant's records — which are the SLA evidence for whether a service
// met its contracted rate.
//
// Migration 438 adds organization_id, backfilled from client, then contract,
// then device. Rows with none of the three stay NULL — legacy only, since
// every new row is stamped at creation — and are ADOPTED by the first tenant
// that writes to one.
//
// 438 also gives tested_at a DEFAULT. It was TIMESTAMP NOT NULL with no
// default and MySQL 8 ships explicit_defaults_for_timestamp = ON, so
// POST /speed-tests with the body the API documents was a hard 500.
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

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };
const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${token()}`);

const MINE = { id: 10, organization_id: 1, client_id: 5, download_mbps: '95.500', test_source: 'technician' };
const LEGACY = { id: 11, organization_id: null, client_id: null, contract_id: null, device_id: null, download_mbps: '10.000', test_source: 'automated_probe' };

function wireDb({ rows = [MINE], targetOrg = 1 } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: rows.length }]];
    if (/SELECT organization_id FROM speed_tests WHERE id = \?/.test(sql)) {
      return [targetOrg === undefined ? [] : [{ organization_id: targetOrg }]];
    }
    if (/FROM `?speed_tests`?/i.test(sql)) return [rows];
    if (/^INSERT INTO `?speed_tests`?/i.test(sql)) return [{ insertId: 99, affectedRows: 1 }];
    if (/^UPDATE `?speed_tests`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}
const listSql = () => db.query.mock.calls.find(([s]) => /FROM speed_tests st/.test(s) && !/COUNT/.test(s));

beforeEach(() => jest.clearAllMocks());

describe('reads admit my org AND unattributed rows', () => {
  it('never emits a bare organization_id = ?', async () => {
    // The #582 anti-fix: a bare predicate hides every unattributed row, so a
    // single-tenant install — where clients/contracts/devices legitimately
    // carry a NULL org — sees an empty page and concludes it has no data.
    wireDb();
    await auth(request(app).get('/api/v1/speed-tests'));
    expect(listSql()[0]).toMatch(/organization_id = \? OR st\.organization_id IS NULL/);
    expect(listSql()[0]).not.toMatch(/WHERE st\.organization_id = \?[^ ]/);
  });

  it('flags an unattributed row so the UI can explain it', async () => {
    wireDb({ rows: [LEGACY] });
    const res = await auth(request(app).get('/api/v1/speed-tests'));
    expect(res.status).toBe(200);
    expect(listSql()[0]).toMatch(/IS NULL\) AS is_unattributed/);
  });

  it('binds the org before any filter, so the predicates cannot swap', async () => {
    wireDb();
    await auth(request(app).get('/api/v1/speed-tests?test_source=technician&client_id=5'));
    expect(listSql()[1][0]).toBe(1);
  });

  it('keeps every filter the page actually sends', async () => {
    // Replacing crudController.list with a hand-written one drops any query
    // param not re-implemented. SpeedTestList sends test_source + paging;
    // client/contract/device filters back the detail pages.
    wireDb();
    await auth(request(app).get('/api/v1/speed-tests?test_source=technician&client_id=5&contract_id=7&device_id=9'));
    const [sql, params] = listSql();
    expect(sql).toMatch(/st\.test_source = \?/);
    expect(sql).toMatch(/st\.client_id = \?/);
    expect(sql).toMatch(/st\.contract_id = \?/);
    expect(sql).toMatch(/st\.device_id = \?/);
    expect(params).toEqual([1, '5', '7', '9', 'technician']);
  });

  it('GET /:id is scoped too — no reading another tenant by guessing an id', async () => {
    wireDb({ rows: [] });
    const res = await auth(request(app).get('/api/v1/speed-tests/999'));
    expect(res.status).toBe(404);
    const one = db.query.mock.calls.find(([s]) => /FROM speed_tests st WHERE st\.id = \?/.test(s));
    expect(one[0]).toMatch(/organization_id = \? OR st\.organization_id IS NULL/);
  });
});

describe('writes are strictly scoped', () => {
  it('a speed test cannot be moved to another organization', async () => {
    wireDb();
    const res = await auth(request(app).put('/api/v1/speed-tests/10')).send({ organization_id: 2, notes: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ORG_IMMUTABLE');
    expect(db.query.mock.calls.some(([s]) => /^UPDATE `?speed_tests`?/i.test(s))).toBe(false);
  });

  it('nor made unattributed again by setting it null', async () => {
    wireDb();
    const res = await auth(request(app).put('/api/v1/speed-tests/10')).send({ organization_id: null });
    expect(res.status).toBe(422);
  });
});

describe('the WRITE predicate itself, not just the route guards', () => {
  it('hasOrgScope must stay true', () => {
    // The route guards (reject-reassignment, adopt) all still pass with
    // hasOrgScope=false, because they run BEFORE the model. What actually
    // stops one tenant writing another's row is BaseModel emitting
    // `AND organization_id = ?` — the lesson from #599, where reverting this
    // flag survived a first round of mutation testing.
    const SpeedTest = require('../src/models/SpeedTest');
    expect(SpeedTest.hasOrgScope).toBe(true);
  });

  it("does not write another tenant's speed test", async () => {
    wireDb({ rows: [MINE], targetOrg: 1 });
    await auth(request(app).put('/api/v1/speed-tests/10')).send({ notes: 'edited' });
    const upd = db.query.mock.calls.find(([s]) => /^UPDATE `?speed_tests`?/i.test(s));
    expect(upd).toBeDefined();
    expect(upd[0]).toMatch(/organization_id = \?/);
  });
});

describe('an unattributed legacy row is adopted, not blocked', () => {
  it('writing to one stamps the acting org first', async () => {
    wireDb({ rows: [LEGACY], targetOrg: null });
    await auth(request(app).put('/api/v1/speed-tests/11')).send({ notes: 'reviewed' });

    const adopt = db.query.mock.calls.find(
      ([s]) => /^UPDATE speed_tests SET organization_id = \? WHERE id = \? AND organization_id IS NULL/.test(s),
    );
    expect(adopt).toBeDefined();
    expect(adopt[1][0]).toBe(1);
  });

  it('does NOT touch a row that already has an owner', async () => {
    // Adoption must never re-home another tenant's record.
    wireDb({ rows: [MINE], targetOrg: 2 });
    await auth(request(app).put('/api/v1/speed-tests/10')).send({ notes: 'x' });
    expect(db.query.mock.calls.some(
      ([s]) => /SET organization_id = \? WHERE id = \? AND organization_id IS NULL/.test(s),
    )).toBe(false);
  });
});

describe('POST /speed-tests works at all', () => {
  // Before 438 this endpoint was a hard 500 for the body its own schema
  // documents: tested_at is NOT NULL and had no DEFAULT, and the create schema
  // never declared it, so nothing could supply one.
  it('accepts the documented body', async () => {
    wireDb();
    const res = await auth(request(app).post('/api/v1/speed-tests')).send({
      download_mbps: 95.5, upload_mbps: 20.1, latency_ms: 12.4, test_source: 'technician',
    });
    expect(res.status).toBe(201);
  });

  it('the column now carries a DEFAULT so the INSERT can omit tested_at', () => {
    const schema = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../database/schema.sql'), 'utf8',
    );
    const table = schema.slice(
      schema.indexOf('CREATE TABLE IF NOT EXISTS speed_tests'),
      schema.indexOf('CREATE TABLE IF NOT EXISTS speed_tests') + 3000,
    );
    expect(table).toMatch(/tested_at\s+TIMESTAMP\s+NOT NULL DEFAULT CURRENT_TIMESTAMP/);
  });

  it('an explicit tested_at is validated instead of silently ignored', async () => {
    // validate() IGNORES undeclared fields, so before this the value reached
    // the INSERT unchecked.
    wireDb();
    const res = await auth(request(app).post('/api/v1/speed-tests')).send({
      download_mbps: 1, upload_mbps: 1, test_source: 'external', tested_at: 12345,
    });
    expect(res.status).toBe(422);
  });

  it('a missing test_source is a 422 naming the field, not a 500', async () => {
    // test_source is NOT NULL with no default too — optional in the schema
    // meant MySQL raised ER_NO_DEFAULT_FOR_FIELD and the client got
    // "Internal server error" with no clue which field was wrong.
    wireDb();
    const res = await auth(request(app).post('/api/v1/speed-tests')).send({
      download_mbps: 50, upload_mbps: 10,
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/test_source/);
  });

  it('server_location is bounded by the real column width', async () => {
    // VARCHAR(150). The schema allowed 255, so a legal-looking value passed
    // validation and then died in strict mode as ER_DATA_TOO_LONG — a 500.
    wireDb();
    const res = await auth(request(app).post('/api/v1/speed-tests')).send({
      download_mbps: 1, upload_mbps: 1, test_source: 'external', server_location: 'x'.repeat(200),
    });
    expect(res.status).toBe(422);
  });
});
