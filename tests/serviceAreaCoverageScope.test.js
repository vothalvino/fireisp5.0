'use strict';
// =============================================================================
// FireISP 5.0 — coverage zones are org-scoped
// =============================================================================
// GET /service-areas/:id/coverage-zones took the id straight from the URL and
// queried coverage_zones with no org predicate:
//
//     SELECT * FROM coverage_zones WHERE service_area_id = ? AND deleted_at IS NULL
//
// so any tenant could enumerate another tenant's coverage polygons by guessing
// an id — where a competitor sells, and where they do not. Every sibling verb on
// this router goes through crudController and is scoped; only this hand-written
// one was not, which is the recurring shape: the generic CRUD is safe and the
// bespoke sub-route beside it is the gap.
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

function wire({ areaVisible = true } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (typeof sql === 'string' && sql.includes('`users`')) return [[ADMIN]];
    if (/FROM `?service_areas`?/i.test(sql)) return [areaVisible ? [{ id: 3, organization_id: 1 }] : []];
    if (/FROM coverage_zones/.test(sql)) return [[{ id: 8, service_area_id: 3, organization_id: 1 }]];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}
const zoneQuery = () => db.query.mock.calls.find(([s]) => /FROM coverage_zones/.test(s));

beforeEach(() => { jest.clearAllMocks(); wire(); });

describe("another tenant's coverage is not enumerable", () => {
  it('404s when the service area is not the caller\'s', async () => {
    wire({ areaVisible: false });
    const res = await auth(request(app).get('/api/v1/service-areas/999/coverage-zones'));
    expect(res.status).toBe(404);
  });

  it('does not query coverage_zones at all for a foreign area', async () => {
    wire({ areaVisible: false });
    await auth(request(app).get('/api/v1/service-areas/999/coverage-zones'));
    expect(zoneQuery()).toBeUndefined();
  });

  it('the parent lookup binds the acting org', async () => {
    await auth(request(app).get('/api/v1/service-areas/3/coverage-zones'));
    const probe = db.query.mock.calls.find(([s]) => /FROM `?service_areas`?/i.test(s));
    expect(probe[0]).toMatch(/organization_id = \?/);
    expect(probe[1]).toContain(1);
  });
});

describe('the zone query is scoped in its own right', () => {
  it('carries an org predicate', async () => {
    // Belt and braces: relying on the parent check alone is how the sibling
    // sub-routes in #613 and #623 came to be wrong.
    await auth(request(app).get('/api/v1/service-areas/3/coverage-zones'));
    expect(zoneQuery()[0]).toMatch(/organization_id = \?/);
    expect(zoneQuery()[1]).toEqual(['3', 1, 1]);
  });

  it('admits NULL-org rows so single-tenant installs still work', async () => {
    await auth(request(app).get('/api/v1/service-areas/3/coverage-zones'));
    expect(zoneQuery()[0]).toMatch(/\? IS NULL AND organization_id IS NULL/);
  });

  it('still returns zones for an area the caller owns', async () => {
    const res = await auth(request(app).get('/api/v1/service-areas/3/coverage-zones'));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
