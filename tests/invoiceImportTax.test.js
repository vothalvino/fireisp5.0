'use strict';
// =============================================================================
// FireISP 5.0 — the CSV invoice importer and tax
// =============================================================================
// Three defects in one statement, all of which write a wrong fiscal row
// silently and en masse — an importer is the one place a mistake is multiplied
// by ten thousand.
//
//   1. A row CARRYING a tax column skipped the resolver entirely. So
//      "tax_rate,0" — or an unparseable "N/A", which parseFloat turns into 0 —
//      imported a 0%-IVA invoice for a non-exempt MX client. Note an EMPTY cell
//      was always fine: it is not `provided()`, so the resolver ran.
//   2. No fraction normalisation. invoices.tax_rate is DECIMAL(5,4) and a CSV
//      written by a human says "16", not "0.16" — which overflows the column.
//   3. currency was omitted from the INSERT, so every imported invoice fell to
//      the column default of 'USD' — on a Mexican install that then fails to
//      stamp with CFDI_UNSUPPORTED_CURRENCY.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../src/config/database', () => ({
  query: jest.fn(), execute: jest.fn(), getConnection: jest.fn(), close: jest.fn(), pool: { end: jest.fn() },
}));
jest.mock('../src/models/Organization', () => ({
  getCurrency: jest.fn().mockResolvedValue('MXN'),
  getLocale: jest.fn().mockResolvedValue('MX'),
  update: jest.fn(),
  findById: jest.fn(),
}));

const config = require('../src/config');
const db = require('../src/config/database');
const Organization = require('../src/models/Organization');
const app = require('../src/app');

const token = () => jwt.sign({ sub: 1, email: 'a@b.c', role: 'admin', orgId: 1 }, config.jwt.secret, { expiresIn: '1h' });
const isUserLookup = (sql) => typeof sql === 'string' && sql.includes('`users`');
const ADMIN = { id: 1, email: 'a@b.c', role: 'admin', status: 'active', organization_id: 1 };

const HEADER = 'client_id,invoice_number,issue_date,due_date,subtotal,tax_rate,total,status';
const importCsv = (csv) => request(app)
  .post('/api/v1/import/invoices')
  .set('Authorization', `Bearer ${token()}`)
  .send({ csv });

/** exempt=false client, and an org default rate of 16%. */
function wireDb({ exempt = false, defaultRate = '0.1600' } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/FROM clients/.test(sql)) return [[{ tax_exempt: exempt ? 1 : 0, locale: 'MX', zip_code: '06000' }]];
    if (/FROM tax_rules/.test(sql)) return [[]];
    if (/FROM tax_rates/.test(sql)) return [defaultRate === null ? [] : [{ id: 9, rate: defaultRate }]];
    if (/INSERT INTO invoices/.test(sql)) return [{ insertId: 1 }];
    return [[]];
  });
}
const insertOf = () => db.query.mock.calls.find(c => /INSERT INTO invoices/.test(c[0]));

beforeEach(() => {
  jest.clearAllMocks();
  Organization.getCurrency.mockResolvedValue('MXN');
  Organization.getLocale.mockResolvedValue('MX');
});

describe('a literal 0 in the tax column no longer imports an untaxed invoice', () => {
  it('rejects the row and says why', async () => {
    wireDb();
    const res = await importCsv(`${HEADER}\n42,MIG-1,2026-07-01,2026-07-31,1000,0,1000,sent`);
    expect(res.status).toBe(200);
    expect(res.body.data.imported).toBe(0);
    expect(res.body.data.errors[0].error).toMatch(/16%|no tax/i);
    expect(insertOf()).toBeUndefined();
  });

  it('rejects an unparseable rate, which parseFloat silently turned into 0', async () => {
    wireDb();
    const res = await importCsv(`${HEADER}\n42,MIG-2,2026-07-01,2026-07-31,1000,N/A,1000,sent`);
    expect(res.body.data.imported).toBe(0);
    expect(insertOf()).toBeUndefined();
  });

  it('reports the failing row NUMBER, so a 10k-line file is fixable', async () => {
    wireDb();
    const res = await importCsv(
      `${HEADER}\n42,MIG-3,2026-07-01,2026-07-31,1000,0.16,1160,sent\n42,MIG-4,2026-07-01,2026-07-31,1000,0,1000,sent`,
    );
    expect(res.body.data.imported).toBe(1);
    expect(res.body.data.errors).toHaveLength(1);
    expect(res.body.data.errors[0].row).toBe(3);   // header is row 1
  });

  it('still imports a zero-tax row for an EXEMPT client', async () => {
    // Exempt is handled before the tax column is read, and zero is correct there.
    wireDb({ exempt: true });
    const res = await importCsv(`${HEADER}\n42,MIG-5,2026-07-01,2026-07-31,1000,0,1000,sent`);
    expect(res.body.data.imported).toBe(1);
  });

  it('still imports zero tax when the org itself has no rate', async () => {
    // A non-MX org running 0% must not be blocked by a Mexican assumption.
    Organization.getLocale.mockResolvedValue('US');
    wireDb({ defaultRate: null });
    const res = await importCsv(`${HEADER}\n42,MIG-6,2026-07-01,2026-07-31,1000,0,1000,sent`);
    expect(res.body.data.imported).toBe(1);
  });

  it('leaves an EMPTY tax cell alone — the resolver already handled it', async () => {
    wireDb();
    const res = await importCsv(`${HEADER}\n42,MIG-7,2026-07-01,2026-07-31,1000,,1160,sent`);
    expect(res.body.data.imported).toBe(1);
    // Resolver supplied 16%, and the total is derived rather than trusted.
    expect(insertOf()[1]).toEqual(expect.arrayContaining([0.16, 160, 1160]));
  });
});

describe('a human-written percent does not overflow DECIMAL(5,4)', () => {
  it('normalises "16" to 0.16', async () => {
    wireDb();
    await importCsv(`${HEADER}\n42,MIG-8,2026-07-01,2026-07-31,1000,16,1160,sent`);
    const params = insertOf()[1];
    expect(params).toContain(0.16);
    // The raw 16 would have overflowed the column and been stored as 9.9999.
    expect(params).not.toContain(16);
  });

  it('leaves an already-fractional rate alone', async () => {
    wireDb();
    await importCsv(`${HEADER}\n42,MIG-9,2026-07-01,2026-07-31,1000,0.16,1160,sent`);
    expect(insertOf()[1]).toContain(0.16);
  });
});

describe('currency is written, not defaulted to USD', () => {
  it("uses the org's currency", async () => {
    wireDb();
    await importCsv(`${HEADER}\n42,MIG-10,2026-07-01,2026-07-31,1000,0.16,1160,sent`);
    expect(insertOf()[0]).toMatch(/currency/);
    expect(insertOf()[1]).toContain('MXN');
  });

  it('resolves it ONCE for the whole file, not per row', async () => {
    // A 10,000-row import would otherwise issue 10,000 identical org lookups.
    wireDb();
    const rows = Array.from({ length: 4 }, (_, i) =>
      `42,MIG-B${i},2026-07-01,2026-07-31,1000,0.16,1160,sent`).join('\n');
    await importCsv(`${HEADER}\n${rows}`);
    expect(Organization.getCurrency).toHaveBeenCalledTimes(1);
  });
});
