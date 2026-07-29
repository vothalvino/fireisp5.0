'use strict';
// =============================================================================
// FireISP 5.0 — the tax/IVA exemption needs its own permission (j13)
// =============================================================================
// Setting `tax_exempt` was gated on `clients.update`, which migration 119 grants
// to SUPPORT. So a support agent could flip a client to IVA-exempt — and that is
// not a support decision: the flag changes what the CFDI declares (ObjetoImp
// '02' + a TipoFactor='Exento' traslado instead of a rated one), so a wrong
// value files an incorrect fiscal document with SAT, correctable only by
// cancelling and re-issuing.
//
// Migration 435 adds `clients.tax_exemption`, granted to admin ONLY.
//
// The comparison is by VALUE, not presence, and that is the part most likely to
// be broken by a later "simplification": the client form re-sends the whole
// record on save, so a presence check would 403 a support agent editing a phone
// number on any client that happens to already be exempt.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), queryReplica: jest.fn(), execute: jest.fn(),
  getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');

const STORED = {
  id: 9, organization_id: 1, name: 'Ferretería Díaz', phone: '555-0100',
  tax_exempt: 0, tax_exempt_reason: null,
};

/** A support user: holds clients.update, NOT clients.tax_exemption. */
const SUPPORT = { id: 2, email: 's@b.c', role: 'support', status: 'active', organization_id: 1 };
/** An org-membership admin: holds both. */
const ADMIN = { id: 1, email: 'a@b.c', role: 'manager', status: 'active', organization_id: 1 };

const token = (u) => jwt.sign(
  { sub: u.id, email: u.email, role: u.role, orgId: 1 }, config.jwt.secret, { expiresIn: '1h' },
);
const auth = (r, u) => r.set('Authorization', `Bearer ${token(u)}`);

function wireDb(actor, permissions, stored = STORED) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[actor]];
    if (/FROM `?clients`?/i.test(sql)) return [[stored]];
    if (/^UPDATE `?clients`?/i.test(sql)) return [{ affectedRows: 1 }];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
  jest.spyOn(User, 'getPermissions').mockResolvedValue(permissions);
}

const SUPPORT_PERMS = ['clients.view', 'clients.create', 'clients.update'];
const ADMIN_PERMS = [...SUPPORT_PERMS, 'clients.tax_exemption'];

beforeEach(() => jest.restoreAllMocks());
afterEach(() => jest.clearAllMocks());

describe('changing the exemption requires clients.tax_exemption', () => {
  it('403s a support agent who holds clients.update, and writes nothing', async () => {
    wireDb(SUPPORT, SUPPORT_PERMS);
    const res = await auth(request(app).put('/api/v1/clients/9'), SUPPORT)
      .send({ tax_exempt: true, tax_exempt_reason: 'NGO' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TAX_EXEMPTION_FORBIDDEN');
    expect(db.query.mock.calls.some(([s]) => /^UPDATE `?clients`?/i.test(s))).toBe(false);
  });

  it('allows an admin who holds the permission', async () => {
    wireDb(ADMIN, ADMIN_PERMS);
    const res = await auth(request(app).put('/api/v1/clients/9'), ADMIN)
      .send({ tax_exempt: true, tax_exempt_reason: 'NGO' });

    expect(res.status).not.toBe(403);
  });

  it('blocks editing the REASON alone — it is the recorded legal basis', async () => {
    // The reason is not decoration: it is what an auditor reads to justify why
    // this client is exempt. Rewriting it without the permission is the same
    // fiscal act as setting the flag, so guarding only `tax_exempt` leaves the
    // justification editable by anyone with clients.update.
    wireDb(SUPPORT, SUPPORT_PERMS, { ...STORED, tax_exempt: 1, tax_exempt_reason: 'Art. 15 LIVA' });
    const res = await auth(request(app).put('/api/v1/clients/9'), SUPPORT)
      .send({ tax_exempt: true, tax_exempt_reason: 'because the customer asked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TAX_EXEMPTION_FORBIDDEN');
  });

  it('blocks REMOVING an exemption too, not just adding one', async () => {
    // Un-exempting is the same fiscal decision in reverse: the next CFDI starts
    // declaring tax on a client who may legitimately owe none.
    wireDb(SUPPORT, SUPPORT_PERMS, { ...STORED, tax_exempt: 1, tax_exempt_reason: 'NGO' });
    const res = await auth(request(app).put('/api/v1/clients/9'), SUPPORT)
      .send({ tax_exempt: false });

    expect(res.status).toBe(403);
  });
});

describe('ordinary client edits are untouched', () => {
  it('a support agent can still edit a phone number', async () => {
    wireDb(SUPPORT, SUPPORT_PERMS);
    const res = await auth(request(app).put('/api/v1/clients/9'), SUPPORT)
      .send({ phone: '555-0199' });

    expect(res.status).not.toBe(403);
  });

  it('re-sending the SAME exemption value is not a change', async () => {
    // THE regression this guards: the client form re-sends the whole record on
    // save. A presence check instead of a value check would 403 every support
    // edit of any client that happens to be exempt.
    wireDb(SUPPORT, SUPPORT_PERMS, { ...STORED, tax_exempt: 1, tax_exempt_reason: 'NGO' });
    const res = await auth(request(app).put('/api/v1/clients/9'), SUPPORT)
      .send({ phone: '555-0199', tax_exempt: true, tax_exempt_reason: 'NGO' });

    expect(res.status).not.toBe(403);
  });

  it('tolerates the 0/1 round-trip MySQL does on booleans', async () => {
    // Stored as 0/1, re-sent as false/true. Comparing loosely here is not
    // sloppiness — a strict === would read every round-trip as a change.
    wireDb(SUPPORT, SUPPORT_PERMS, { ...STORED, tax_exempt: 0 });
    const res = await auth(request(app).put('/api/v1/clients/9'), SUPPORT)
      .send({ tax_exempt: false });

    expect(res.status).not.toBe(403);
  });

  it('treats a null stored reason and an omitted one as equal', async () => {
    wireDb(SUPPORT, SUPPORT_PERMS, { ...STORED, tax_exempt_reason: null });
    const res = await auth(request(app).put('/api/v1/clients/9'), SUPPORT)
      .send({ phone: '555-0111', tax_exempt_reason: '' });

    expect(res.status).not.toBe(403);
  });
});

describe('the permission is seeded and granted, or it is a silent 403 for everyone', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'database/migrations/435_client_tax_exemption_permission.sql'), 'utf8',
  );

  it('seeds the permission row', () => {
    expect(sql).toMatch(/INSERT IGNORE INTO permissions/i);
    expect(sql).toContain('clients.tax_exemption');
  });

  it('grants it to admin — an unseeded grant is a 403 nobody can explain', () => {
    expect(sql).toMatch(/INSERT IGNORE INTO role_permissions/i);
    expect(sql).toMatch(/WHERE\s+r\.name = 'admin'/i);
  });

  it('does NOT grant it to support — that is the whole point', () => {
    expect(sql).not.toMatch(/r\.name = 'support'/i);
  });
});
