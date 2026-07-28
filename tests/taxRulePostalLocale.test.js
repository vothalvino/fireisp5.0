'use strict';
// =============================================================================
// FireISP 5.0 — an MX org may only use 5-digit postal codes in a tax rule
// =============================================================================
// A Mexican código postal is always exactly five digits. Anything else in an
// MX org's tax rule is a data-entry error, and a SILENT one: "0801" or "K1A*"
// saves happily, matches no client ever, and leaves the operator wondering why
// their border rule never applies. A rule that never fires is how a 16% invoice
// quietly goes to an 8% subscriber.
//
// The constraint is per-ORG, not global. #556 generalised the matcher precisely
// so a Panama org can use 0801 and a Canadian K1A* — this must not undo that.
// Half of what is asserted below is that other locales are untouched.
// =============================================================================

const request = require('supertest');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 7; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
  userHasPermission: async () => true,
}));
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/models/Organization', () => ({ getLocale: jest.fn(), getCurrency: jest.fn() }));

const db = require('../src/config/database');
const Organization = require('../src/models/Organization');
const app = require('../src/app');

const post = (postal_codes) => request(app)
  .post('/api/v1/tax-rules')
  .send({ name: 'Zone rule', rate: 0.08, tax_type: 'vat', status: 'active', postal_codes });

beforeEach(() => {
  jest.clearAllMocks();
  // A successful insert, so anything that fails did so in the guard.
  db.query.mockImplementation(async (sql) => {
    if (/^INSERT INTO/i.test(sql)) return [{ insertId: 5 }];
    if (/FROM `?tax_rules`?/i.test(sql)) return [[{ id: 5, name: 'Zone rule', postal_codes: '21000-22999' }]];
    return [[]];
  });
});

describe('an MX org is held to 5 digits', () => {
  beforeEach(() => Organization.getLocale.mockResolvedValue('MX'));

  it.each([
    ['0801', 'a 4-digit code (Panama shape)'],
    ['0801-0899', 'a 4-digit range'],
    ['K1A*', 'an alphanumeric prefix'],
    ['21000-2299', 'a range with one short end'],
    ['210000', 'six digits'],
  ])('rejects %s (%s)', async (spec) => {
    const res = await post(spec);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('POSTAL_CODE_FORMAT_MX');
  });

  it('names the offending entries so the operator can fix them', async () => {
    const res = await post('21000-22999,0801,K1A*');
    // Assert against the OFFENDER LIST, not the whole message: the message ends
    // with an example that legitimately contains a valid range, so a whole-string
    // "must not contain" check fails for the wrong reason.
    const listed = /Not valid here: ([^.]+)\./.exec(res.body.error.message)[1];
    expect(listed).toMatch(/0801/);
    expect(listed).toMatch(/K1A\*/);
    expect(listed).not.toMatch(/21000-22999/);
  });

  it.each([
    ['21000-22999', 'a 5-digit range'],
    ['88000', 'a single 5-digit code'],
    ['21000-22999,32000-32699,88000', 'the seeded border shape'],
    [' 21000 - 22999 , 88000 ', 'whitespace around entries'],
  ])('accepts %s (%s)', async (spec) => {
    expect((await post(spec)).status).toBe(201);
  });

  it('ignores an update that does not touch postal_codes', async () => {
    const res = await request(app).put('/api/v1/tax-rules/5').send({ name: 'Renamed' });
    expect(res.status).not.toBe(422);
  });
});

describe('other locales keep their own postal systems', () => {
  it.each([
    ['PA-style 4-digit', '0801-0899'],
    ['CA-style prefix', 'K1A*,M5V*'],
    ['AU-style 4-digit', '3000-3999'],
    ['US-style 5-digit', '90000-90999'],
  ])('a global org accepts %s', async (_label, spec) => {
    // #556 exists because these were all rejected. Re-adding an MX rule must
    // not quietly re-break them.
    Organization.getLocale.mockResolvedValue('global');
    expect((await post(spec)).status).toBe(201);
  });

  it('does not even look up the locale when no postal_codes are sent', async () => {
    Organization.getLocale.mockResolvedValue('MX');
    await request(app).post('/api/v1/tax-rules')
      .send({ name: 'Default only', rate: 0.16, tax_type: 'vat', is_default: true });
    expect(Organization.getLocale).not.toHaveBeenCalled();
  });
});
