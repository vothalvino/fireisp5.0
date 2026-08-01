'use strict';
// =============================================================================
// FireISP 5.0 — the client timeline does not leak another tenant's emails
// =============================================================================
// activityTimeline UNIONs five sources, each keyed on a client_id that arrives
// straight from the URL. Four of them carried their own org predicate. The
// email_logs branch did not:
//
//     FROM email_logs el
//     WHERE el.client_id = ?          <- no organization_id
//
// So `GET /clients/<another tenant's client id>/timeline` returned EMPTY for
// interactions, tickets, payments and SMS — all correctly scoped — while still
// listing that client's email SUBJECTS and RECIPIENT ADDRESSES.
//
// It survived because a comment above the query said "email_logs has no
// organization_id column — it is scoped via the client". That was true when the
// query was written; migration 386 added the column and this query was never
// revisited. A stale comment that justifies the gap is worse than no comment.
//
// Fixed twice over: the branch now scopes like its four siblings, and the route
// proves client ownership first — five separate predicates staying correct
// forever is exactly the assumption that failed here, and a partly-populated
// 200 reads as "little history" rather than as a refusal.
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

function wire({ clientVisible = true } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[ADMIN]];
    if (/FROM `?clients`?/i.test(sql)) return [clientVisible ? [{ id: 5, organization_id: 1 }] : []];
    return [[]];
  });
  db.queryReplica.mockResolvedValue([[]]);
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const timelineSql = () => db.queryReplica.mock.calls[0]?.[0];
const timelineParams = () => db.queryReplica.mock.calls[0]?.[1];

beforeEach(() => { jest.clearAllMocks(); wire(); });

describe('every branch of the timeline is org-scoped', () => {
  it('the email_logs branch carries an org predicate', async () => {
    await auth(request(app).get('/api/v1/clients/5/timeline'));
    expect(timelineSql()).toMatch(/FROM email_logs el\s+WHERE el\.client_id = \?\s+AND \(\? IS NULL OR el\.organization_id = \?\)/);
  });

  it.each([
    ['client_interactions', /ci\.organization_id = \?/],
    ['tickets', /t\.organization_id = \?/],
    ['payments', /p\.organization_id = \?/],
    ['email_logs', /el\.organization_id = \?/],
    ['sms_logs', /sl\.organization_id = \?/],
  ])('%s is scoped', async (_name, re) => {
    await auth(request(app).get('/api/v1/clients/5/timeline'));
    expect(timelineSql()).toMatch(re);
  });

  it('binds three params per branch, five branches', async () => {
    // The email branch used to bind clientId alone. A mismatch between
    // placeholders and params silently shifts EVERY later binding, which would
    // scope the sms branch by a client id.
    await auth(request(app).get('/api/v1/clients/5/timeline'));
    expect(timelineParams()).toHaveLength(15);
    expect(timelineParams()).toEqual(['5', 1, 1, '5', 1, 1, '5', 1, 1, '5', 1, 1, '5', 1, 1]);
  });

  it('does not filter email_logs on deleted_at', async () => {
    // That table has no such column; adding the filter for symmetry would be a
    // 500, not a tightening.
    await auth(request(app).get('/api/v1/clients/5/timeline'));
    expect(timelineSql()).not.toMatch(/el\.deleted_at/);
  });
});

describe("a foreign client's timeline is refused outright", () => {
  it('404s instead of returning a partly-populated 200', async () => {
    // Before, the org predicates alone made this a 200 with an empty-ish
    // timeline, which reads as "this client has little history".
    wire({ clientVisible: false });
    const res = await auth(request(app).get('/api/v1/clients/999/timeline'));
    expect(res.status).toBe(404);
  });

  it('does not even build the timeline query', async () => {
    wire({ clientVisible: false });
    await auth(request(app).get('/api/v1/clients/999/timeline'));
    expect(db.queryReplica).not.toHaveBeenCalled();
  });

  it('the ownership check binds the acting org', async () => {
    wire({ clientVisible: false });
    await auth(request(app).get('/api/v1/clients/999/timeline'));
    const probe = db.query.mock.calls.find(([s]) => /FROM `?clients`?/i.test(s));
    expect(probe[0]).toMatch(/organization_id = \?/);
    expect(probe[1]).toContain(1);
  });
});
