'use strict';
// =============================================================================
// FireISP 5.0 — PUT/PATCH /organizations/:id may not write another tenant's row
// =============================================================================
// Organization.hasOrgScope is false, so BaseModel.update SILENTLY omits the
// tenant predicate: `UPDATE organizations SET ... WHERE id = ?`. Combined with
// requirePermission resolving against the CALLER's active org (never the
// target), any org's membership-`admin` could overwrite any other org's row by
// id — and GET / is equally unscoped, so the ids were listed for them.
//
// Found by the adversarial review of the privacy-notice branch, which made the
// hole materially worse: privacy_notice is text served to the TARGET org's
// subscribers and hashed into their consent records, so this was a channel for
// putting attacker-authored legal text in front of another ISP's customers.
//
// The guard is the one this router already used for the fiscal sub-routes:
// act on your own org, or be a platform admin (legacy users.role='admin').
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),   // permission granted; scoping is what's under test
  requireRole: () => (_req, _res, next) => next(),
  userHasPermission: async () => true,
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

// role 'manager' = NOT the legacy admin bypass tier. orgId 1 = the caller's org.
const token = (role = 'manager') => jwt.sign(
  { sub: 1, email: 'a@b.c', role, orgId: 1 }, config.jwt.secret, { expiresIn: '1h' },
);
const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');

function wireDb(role = 'manager') {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[{ id: 1, email: 'a@b.c', role, status: 'active', organization_id: 1 }]];
    if (/^UPDATE `?organizations`?/i.test(sql)) return [{ affectedRows: 1 }];
    if (/FROM `?organizations`?/i.test(sql)) return [[{ id: 9, name: 'Other ISP' }]];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const updateOf = () => db.query.mock.calls.find(c => /^UPDATE `?organizations`?/i.test(c[0]));

beforeEach(() => jest.clearAllMocks());

describe('a member of org 1 cannot write org 9', () => {
  it('403s a PUT at another org and writes nothing', async () => {
    wireDb();
    const res = await request(app)
      .put('/api/v1/organizations/9')
      .set('Authorization', `Bearer ${token()}`)
      .send({ name: 'Pwned', privacy_notice: '# Evil notice' });
    expect(res.status).toBe(403);
    expect(updateOf()).toBeUndefined();
  });

  it('403s a PATCH at another org and writes nothing', async () => {
    wireDb();
    const res = await request(app)
      .patch('/api/v1/organizations/9')
      .set('Authorization', `Bearer ${token()}`)
      .send({ privacy_notice_version: 'v-evil' });
    expect(res.status).toBe(403);
    expect(updateOf()).toBeUndefined();
  });
});

describe('legitimate writes still work', () => {
  it('allows a member to update their OWN org', async () => {
    wireDb();
    const res = await request(app)
      .put('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${token()}`)
      .send({ name: 'My ISP', privacy_notice: '# Our notice' });
    expect(res.status).not.toBe(403);
    expect(updateOf()).toBeDefined();
  });

  it('allows a platform admin (legacy users.role=admin) to update any org', async () => {
    // Multi-tenant platform operators manage every tenant from one login; this
    // is the same carve-out the fiscal sub-routes make.
    wireDb('admin');
    const res = await request(app)
      .put('/api/v1/organizations/9')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ name: 'Renamed by platform admin' });
    expect(res.status).not.toBe(403);
    expect(updateOf()).toBeDefined();
  });
});
