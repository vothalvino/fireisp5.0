// =============================================================================
// FireISP 5.0 — RADIUS credentials scoping tests
// =============================================================================
// Regression coverage for:
//   - GET /radius, GET /radius/:id, GET /radius/contract/:contractId must
//     never return the cleartext `password` column to a role that only has
//     `devices.view` (this used to leak PPPoE passwords to e.g. `readonly`,
//     which gets every `*.view` permission by wildcard — migration 119).
//   - The new GET /radius/contract/:contractId/credentials and
//     GET /radius/:id/credentials routes return the full row (incl.
//     password) ONLY to a role holding `radius.credentials.view`.
//   - ALL FIVE read routes (the three base ones above plus the two
//     /credentials ones) are org-scoped via a JOIN (through contracts /
//     clients) so a foreign-org contractId/id can never leak another org's
//     RADIUS row. `radius` has no organization_id column
//     (Radius.hasOrgScope === false), so GET /radius and GET /radius/:id
//     needed Radius.findAll/findById/count overrides (see
//     src/models/Radius.js) — the generic BaseModel versions silently skip
//     org scoping entirely for any hasOrgScope=false model, which combined
//     with the radius.credentials.view OR-permission widening (below)
//     opened a same-instance cross-org read for every column except
//     password (which the pre-existing serialize already stripped).
//   - The OR-permission widening itself: support/super_admin/noc_operator
//     hold radius.credentials.view but have never held devices.view, and
//     the frontend's split-fetch UX needs the BASE (password-free) fetch to
//     succeed before it ever attempts the credentials fetch — so the three
//     base routes accept EITHER devices.view OR radius.credentials.view.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'tech@example.com', role: 'technician', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser(overrides = {}) {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'tech@example.com',
    status: 'active',
    role: 'technician',
    organization_id: 1,
    ...overrides,
  });
}

function mockPermissions(perms) {
  User.getPermissions.mockResolvedValue(perms);
}

const RADIUS_ROW_FULL = {
  id: 42,
  client_id: 5,
  contract_id: 7,
  nas_id: 1,
  username: 'sub12345',
  password: 'SuperSecretPPPoEPass',
  status: 'active',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthUser();
});

describe('RADIUS credentials scoping', () => {
  describe('base endpoints — devices.view only (no radius.credentials.view)', () => {
    beforeEach(() => mockPermissions(['devices.view']));

    test('GET /api/v1/radius/contract/:contractId excludes password and org-scopes via JOIN contracts', async () => {
      db.query.mockResolvedValueOnce([[{ id: 42, contract_id: 7, username: 'sub12345', status: 'active' }]]);

      const res = await request(app)
        .get('/api/v1/radius/contract/7')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty('password');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/JOIN contracts c ON c\.id = r\.contract_id AND c\.organization_id = \?/);
      expect(sql).not.toMatch(/password/);
      expect(params).toEqual([1, '7']);
    });

    test('GET /api/v1/radius (list) strips password via serialize and org-scopes both the row query and the count via JOIN clients', async () => {
      // Model.findAll + Model.count (crudController list = 2 queries)
      db.query
        .mockResolvedValueOnce([[RADIUS_ROW_FULL]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/v1/radius')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty('password');
      expect(res.body.data[0].username).toBe('sub12345');

      const [findAllSql, findAllParams] = db.query.mock.calls[0];
      expect(findAllSql).toMatch(/JOIN clients cl ON cl\.id = r\.client_id/);
      expect(findAllSql).toMatch(/cl\.organization_id = \?/);
      expect(findAllParams).toEqual([1]);

      const [countSql, countParams] = db.query.mock.calls[1];
      expect(countSql).toMatch(/JOIN clients cl ON cl\.id = r\.client_id/);
      expect(countSql).toMatch(/cl\.organization_id = \?/);
      expect(countParams).toEqual([1]);
    });

    test('GET /api/v1/radius/:id strips password via serialize and org-scopes via JOIN clients', async () => {
      db.query.mockResolvedValueOnce([[RADIUS_ROW_FULL]]);

      const res = await request(app)
        .get('/api/v1/radius/42')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('password');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/JOIN clients cl ON cl\.id = r\.client_id/);
      expect(sql).toMatch(/cl\.organization_id = \?/);
      expect(params).toEqual(['42', 1]);
    });

    test('cross-org id on GET /radius/:id returns 404, never another org\'s row', async () => {
      db.query.mockResolvedValueOnce([[]]); // JOIN clients excludes it — no matching row

      const res = await request(app)
        .get('/api/v1/radius/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });

    test('cross-org rows are excluded from GET /radius (list) — both the rows and the count are org-scoped', async () => {
      db.query
        .mockResolvedValueOnce([[]])              // findAll: no rows match this org
        .mockResolvedValueOnce([[{ total: 0 }]]); // count: 0 for this org

      const res = await request(app)
        .get('/api/v1/radius')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    test('GET /api/v1/radius/contract/:contractId/credentials is 403 without radius.credentials.view', async () => {
      const res = await request(app)
        .get('/api/v1/radius/contract/7/credentials')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });

    test('GET /api/v1/radius/:id/credentials is 403 without radius.credentials.view', async () => {
      const res = await request(app)
        .get('/api/v1/radius/42/credentials')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(403);
      expect(db.query).not.toHaveBeenCalled();
    });

    test('cross-org contractId returns an empty list rather than another org\'s RADIUS rows', async () => {
      // JOIN excludes the row because the org filter never matches — the
      // mocked query simulates that by returning no rows.
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .get('/api/v1/radius/contract/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // Represents support/super_admin/noc_operator: migration 383 grants them
  // radius.credentials.view but NEVER devices.view (confirmed by grepping
  // every migration for a 'devices.view' grant — only technician, readonly
  // (wildcard), and org-membership admin (migration 119's blanket grant)
  // hold it). The base routes must still be reachable with ONLY
  // radius.credentials.view — requirePermission('devices.view',
  // 'radius.credentials.view') ORs the two slugs — otherwise the frontend's
  // split-fetch flow (base fetch must succeed before the credentials fetch
  // is even attempted) would never let these roles see a password in the UI
  // despite holding the permission that's supposed to grant it.
  describe('base endpoints — ONLY radius.credentials.view (no devices.view — support/super_admin/noc_operator)', () => {
    beforeEach(() => mockPermissions(['radius.credentials.view']));

    test('GET /api/v1/radius/contract/:contractId succeeds password-free and org-scopes via JOIN contracts', async () => {
      db.query.mockResolvedValueOnce([[{ id: 42, contract_id: 7, username: 'sub12345', status: 'active' }]]);

      const res = await request(app)
        .get('/api/v1/radius/contract/7')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty('password');
      expect(res.body.data[0].username).toBe('sub12345');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/JOIN contracts c ON c\.id = r\.contract_id AND c\.organization_id = \?/);
      expect(sql).not.toMatch(/password/);
      expect(params).toEqual([1, '7']);
    });

    test('cross-org contractId returns an empty list, not another org\'s RADIUS rows', async () => {
      db.query.mockResolvedValueOnce([[]]); // JOIN contracts excludes it — no matching row

      const res = await request(app)
        .get('/api/v1/radius/contract/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    test('GET /api/v1/radius (list) succeeds password-free and org-scopes both the row query and the count via JOIN clients', async () => {
      db.query
        .mockResolvedValueOnce([[RADIUS_ROW_FULL]])
        .mockResolvedValueOnce([[{ total: 1 }]]);

      const res = await request(app)
        .get('/api/v1/radius')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0]).not.toHaveProperty('password');

      const [findAllSql, findAllParams] = db.query.mock.calls[0];
      expect(findAllSql).toMatch(/JOIN clients cl ON cl\.id = r\.client_id/);
      expect(findAllSql).toMatch(/cl\.organization_id = \?/);
      expect(findAllParams).toEqual([1]);

      const [countSql, countParams] = db.query.mock.calls[1];
      expect(countSql).toMatch(/JOIN clients cl ON cl\.id = r\.client_id/);
      expect(countSql).toMatch(/cl\.organization_id = \?/);
      expect(countParams).toEqual([1]);
    });

    test('cross-org rows are excluded from GET /radius (list) for a support-only caller too', async () => {
      db.query
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[{ total: 0 }]]);

      const res = await request(app)
        .get('/api/v1/radius')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    test('GET /api/v1/radius/:id succeeds password-free and org-scopes via JOIN clients', async () => {
      db.query.mockResolvedValueOnce([[RADIUS_ROW_FULL]]);

      const res = await request(app)
        .get('/api/v1/radius/42')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('password');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/JOIN clients cl ON cl\.id = r\.client_id/);
      expect(sql).toMatch(/cl\.organization_id = \?/);
      expect(params).toEqual(['42', 1]);
    });

    test('cross-org id on GET /radius/:id returns 404 for a support-only caller too', async () => {
      db.query.mockResolvedValueOnce([[]]); // JOIN clients excludes it — no matching row

      const res = await request(app)
        .get('/api/v1/radius/999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('credentials endpoints — radius.credentials.view granted', () => {
    beforeEach(() => mockPermissions(['radius.credentials.view']));

    test('GET /api/v1/radius/contract/:contractId/credentials returns the cleartext password', async () => {
      db.query.mockResolvedValueOnce([[RADIUS_ROW_FULL]]);

      const res = await request(app)
        .get('/api/v1/radius/contract/7/credentials')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data[0].password).toBe('SuperSecretPPPoEPass');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/SELECT r\.\* FROM radius r/);
      expect(sql).toMatch(/JOIN contracts c ON c\.id = r\.contract_id AND c\.organization_id = \?/);
      expect(params).toEqual([1, '7']);
    });

    test('GET /api/v1/radius/:id/credentials returns the cleartext password, org-scoped via JOIN clients', async () => {
      db.query.mockResolvedValueOnce([[RADIUS_ROW_FULL]]);

      const res = await request(app)
        .get('/api/v1/radius/42/credentials')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.password).toBe('SuperSecretPPPoEPass');

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toMatch(/JOIN clients cl ON cl\.id = r\.client_id AND cl\.organization_id = \?/);
      expect(params).toEqual([1, '42']);
    });

    test('cross-org id on /:id/credentials returns 404, never another org\'s row', async () => {
      db.query.mockResolvedValueOnce([[]]); // JOIN clients excludes it — no matching row

      const res = await request(app)
        .get('/api/v1/radius/999/credentials')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(404);
    });
  });
});
