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
// The guard was originally the one this router used for the fiscal sub-routes:
// act on your own org, or hold users.role='admin'. j56 tightened the second
// half — that role is the per-TENANT admin persona (roles is a GLOBAL table and
// User.resolveGroupMirror copies group.kind into users.role), so EVERY org has
// one and the carve-out re-opened the hole for exactly the callers it excluded.
// The escape is now the INSTALL OPERATOR: users.is_install_operator (migration
// 444) or INSTALL_OPERATOR_USER_IDS, neither of which a request can grant.
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

function wireDb(role = 'manager', isOperator = false) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[{ id: 1, email: 'a@b.c', role, status: 'active', organization_id: 1 }]];
    if (/SELECT is_install_operator FROM users/.test(sql)) {
      return [[{ is_install_operator: isOperator ? 1 : 0 }]];
    }
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

  it('allows the INSTALL OPERATOR to update any org', async () => {
    // A platform operator manages every tenant from one login. The carve-out
    // now keys on the stored operator flag rather than on users.role.
    wireDb('admin', true);
    const res = await request(app)
      .put('/api/v1/organizations/9')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ name: 'Renamed by the install operator' });
    expect(res.status).not.toBe(403);
    expect(updateOf()).toBeDefined();
  });

  it('403s a TENANT admin carrying the same legacy role', async () => {
    // The regression that matters: role='admin' alone used to be the carve-out,
    // and every organisation's admin has it.
    wireDb('admin', false);
    const res = await request(app)
      .put('/api/v1/organizations/9')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ name: 'Pwned by a tenant admin' });
    expect(res.status).toBe(403);
    expect(updateOf()).toBeUndefined();
  });
});

describe('CREATE is install-operator only (product decision, 2026-08-02)', () => {
  // Membership is required to ENTER an org (j66/j67) and create grants the
  // creator none — a tenant admin could only ever mint orgs they cannot enter.
  const insertOf = () => db.query.mock.calls.find(c => /^INSERT INTO `?organizations`?/i.test(c[0]));

  it('403s a tenant admin and inserts nothing', async () => {
    wireDb('admin', false);
    const res = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ name: 'Orphan Org' });
    expect(res.status).toBe(403);
    expect(insertOf()).toBeUndefined();
  });

  it('allows the INSTALL OPERATOR to create', async () => {
    wireDb('admin', true);
    const res = await request(app)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ name: 'New Tenant ISP' });
    expect(res.status).not.toBe(403);
  });
});

describe('DELETE is install-operator only (product decision, 2026-08-02)', () => {
  // Stricter than ownership: a tenant admin may not delete even their OWN
  // organisation — orgs hold stamped CFDIs whose retention outlives the
  // tenant, so decommissioning is the operator's act, like restore.
  it('403s a tenant admin deleting their own org and writes nothing', async () => {
    wireDb('admin', false);
    const res = await request(app)
      .delete('/api/v1/organizations/1')
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).toBe(403);
    expect(updateOf()).toBeUndefined();
  });

  it('allows the INSTALL OPERATOR to delete an org', async () => {
    wireDb('admin', true);
    const res = await request(app)
      .delete('/api/v1/organizations/9')
      .set('Authorization', `Bearer ${token('admin')}`);
    expect(res.status).not.toBe(403);
    expect(updateOf()).toBeDefined();   // soft delete = UPDATE ... deleted_at
  });
});
