'use strict';
// =============================================================================
// FireISP 5.0 — GET /suspension/logs (j22)
// =============================================================================
// The auto-suspension engine had no read surface at all: an operator could
// enable a rule and then had no record of who it suspended or why. On the
// feature most likely to anger a paying customer if it misfires, that is the
// gap that matters most.
//
// suspension_logs carries NO organization_id, so the JOIN to contracts is the
// only thing scoping it — without one, any tenant could read every other
// tenant's disconnection history. Same shape the technician GPS history needed
// (#561), and the same reason it is worth a test that pins the JOIN itself.
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

const LOG = {
  id: 3, contract_id: 31, client_id: 9, suspension_rule_id: 2, action: 'suspended',
  reason: '15 days overdue', triggered_by: 'system', performed_by_user_id: null,
  radius_coa_sent: 1, related_invoice_id: 77,
  suspended_at: '2026-07-20T03:00:00.000Z', restored_at: null,
  client_name: 'Juana Pérez', performed_by_name: null, rule_name: 'Suspensión 15 días',
};

function wireDb(rows = [LOG]) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: rows.length }]];
    if (/FROM suspension_logs/.test(sql)) return [rows];
    return [[]];
  });
}

const logsQuery = () => db.query.mock.calls.find(c => /FROM suspension_logs/.test(c[0]) && !/COUNT/.test(c[0]));
const get = (qs = '') => request(app).get(`/api/v1/suspension/logs${qs}`).set('Authorization', `Bearer ${token()}`);

beforeEach(() => jest.clearAllMocks());

describe('the history is org-scoped through contracts', () => {
  it('JOINs contracts and binds the org FIRST', async () => {
    wireDb();
    const res = await get();
    expect(res.status).toBe(200);
    expect(logsQuery()[0]).toMatch(/JOIN contracts c ON c\.id = sl\.contract_id/);
    expect(logsQuery()[0]).toMatch(/c\.organization_id <=> \?/);
    // Bind ORDER matters: the org predicate is first, so swapping binds would
    // scope by a filter value and silently return the wrong tenant's rows.
    expect(logsQuery()[1][0]).toBe(1);
  });

  it('uses <=> so a single-tenant install (NULL org) still sees its own history', async () => {
    // A plain `=` never matches NULL, and contracts.organization_id is
    // 'NULL = single-tenant deployment' — the endpoint would return nothing.
    wireDb();
    await get();
    expect(logsQuery()[0]).toMatch(/<=>/);
    expect(logsQuery()[0]).not.toMatch(/c\.organization_id = \?/);
  });

  it('counts through the same JOIN, so the total cannot exceed what is visible', async () => {
    wireDb();
    await get();
    const countQ = db.query.mock.calls.find(c => /COUNT\(\*\)/.test(c[0]));
    expect(countQ[0]).toMatch(/JOIN contracts c/);
    expect(countQ[0]).toMatch(/c\.organization_id <=> \?/);
  });
});

describe('the row answers the questions an operator actually asks', () => {
  it('returns who, what, why, and whether RADIUS was told', async () => {
    wireDb();
    const { body } = await get();
    const row = body.data[0];
    expect(row.client_name).toBe('Juana Pérez');
    expect(row.rule_name).toBe('Suspensión 15 días');
    expect(row.action).toBe('suspended');
    expect(row.reason).toBe('15 days overdue');
    expect(row.triggered_by).toBe('system');
    expect(row.radius_coa_sent).toBe(1);
  });

  it('builds performed_by_name from first_name/last_name — users has no `name` column', async () => {
    wireDb();
    await get();
    expect(logsQuery()[0]).toMatch(/CONCAT\(u\.first_name, ' ', u\.last_name\) AS performed_by_name/);
  });

  it('LEFT JOINs the lookups, so a system action with no user still returns', async () => {
    // performed_by_user_id is NULL for engine-triggered rows; an INNER JOIN
    // would hide exactly the rows this page exists to show.
    wireDb();
    await get();
    expect(logsQuery()[0]).toMatch(/LEFT JOIN users u/);
    expect(logsQuery()[0]).toMatch(/LEFT JOIN suspension_rules r/);
    expect(logsQuery()[0]).toMatch(/LEFT JOIN clients cl/);
  });
});

describe('filters', () => {
  it.each([
    ['?contract_id=31', /sl\.contract_id = \?/],
    ['?action=suspended', /sl\.action = \?/],
    ['?triggered_by=system', /sl\.triggered_by = \?/],
  ])('%s adds its predicate', async (qs, re) => {
    wireDb();
    await get(qs);
    expect(logsQuery()[0]).toMatch(re);
  });

  it('applies no extra predicate when unfiltered', async () => {
    wireDb();
    await get();
    expect(logsQuery()[0]).not.toMatch(/sl\.action = \?/);
    expect(logsQuery()[1]).toHaveLength(1);   // just the org bind
  });

  it('caps limit so a huge page cannot be requested', async () => {
    wireDb();
    await get('?limit=99999');
    expect(logsQuery()[0]).toMatch(/LIMIT 200\b/);
  });

  it('newest first — a disconnection history is read from the top', async () => {
    wireDb();
    await get();
    expect(logsQuery()[0]).toMatch(/ORDER BY sl\.suspended_at DESC/);
  });
});
