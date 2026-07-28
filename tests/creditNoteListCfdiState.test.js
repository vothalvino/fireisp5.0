'use strict';
// =============================================================================
// FireISP 5.0 — the credit-note list says whether a note is already stamped (j6)
// =============================================================================
// GET /credit-notes returned unaliased credit_notes columns and nothing else,
// so the UI could not tell a stamped note from an unstamped one: it kept
// offering "Stamp CFDI" on both, and the click came back 409 CFDI_STAMPED.
//
// The list now carries the note's live-CFDI state. "Live" means exactly what
// assertNoLiveCfdi means by it — draft, vigente, cancel_pending — so the
// button disappears precisely when the stamp route would refuse. A CANCELLED
// CFDI must NOT suppress it: a cancelled egreso can legitimately be re-stamped.
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

const NOTES = [
  { id: 5, organization_id: 1, client_id: 9, credit_note_number: 'CN-0005', status: 'issued', total: '1160.00' },
  { id: 6, organization_id: 1, client_id: 9, credit_note_number: 'CN-0006', status: 'issued', total: '580.00' },
  { id: 7, organization_id: 1, client_id: 9, credit_note_number: 'CN-0007', status: 'issued', total: '100.00' },
];

/** @param cfdis rows cfdi_documents should return for the page. */
function wireDb({ notes = NOTES, cfdis = [] } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (isUserLookup(sql)) return [[ADMIN]];
    if (/FROM cfdi_documents/.test(sql)) return [cfdis];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: notes.length }]];
    if (/FROM `?credit_notes`?/.test(sql)) return [notes];
    return [[]];
  });
  db.execute.mockImplementation(db.query.getMockImplementation());
}

const list = () => request(app).get('/api/v1/credit-notes').set('Authorization', `Bearer ${token()}`);
const cfdiQuery = () => db.query.mock.calls.find(c => /FROM cfdi_documents/.test(c[0]));

beforeEach(() => jest.clearAllMocks());

describe('each row reports its live CFDI', () => {
  it('marks the stamped note and leaves the others null', async () => {
    wireDb({ cfdis: [{ credit_note_id: 5, id: 31, uuid: 'AAAA-BBBB', sat_status: 'vigente' }] });
    const res = await list();
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.map(r => [r.id, r]));
    expect(byId[5].cfdi_sat_status).toBe('vigente');
    expect(byId[5].cfdi_uuid).toBe('AAAA-BBBB');
    expect(byId[5].cfdi_document_id).toBe(31);
    // Explicit nulls, not absent keys — the UI tests `!n.cfdi_sat_status`.
    expect(byId[6].cfdi_sat_status).toBeNull();
    expect(byId[7].cfdi_sat_status).toBeNull();
  });

  it('treats a DRAFT CFDI as live — it has already snapshotted its conceptos', async () => {
    wireDb({ cfdis: [{ credit_note_id: 6, id: 32, uuid: null, sat_status: 'draft' }] });
    const { body } = await list();
    expect(body.data.find(r => r.id === 6).cfdi_sat_status).toBe('draft');
  });

  it('asks only for the live statuses, so a CANCELLED CFDI still allows re-stamping', async () => {
    // Mirrors assertNoLiveCfdi exactly: if the guard would let the stamp
    // through, the button has to still be there.
    wireDb();
    await list();
    expect(cfdiQuery()[0]).toMatch(/sat_status IN \('draft', 'vigente', 'cancel_pending'\)/);
    expect(cfdiQuery()[0]).not.toMatch(/'cancelado'/);
  });
});

describe('the lookup is one scoped query for the whole page', () => {
  it('binds every id individually — IN (?) does not expand under db.query', async () => {
    // The durable rule: `IN (?)` binds the ARRAY as one value under this
    // execute-backed driver and silently matches nothing, so the placeholders
    // are built by hand. Assert the built shape, not just the result.
    wireDb();
    await list();
    expect(cfdiQuery()[0]).toMatch(/credit_note_id IN \(\?, \?, \?\)/);
    expect(cfdiQuery()[1]).toEqual([1, 5, 6, 7]);   // orgId first, then the ids
  });

  it('scopes the CFDI lookup to the org', async () => {
    wireDb();
    await list();
    expect(cfdiQuery()[0]).toMatch(/organization_id = \?/);
    expect(cfdiQuery()[1][0]).toBe(1);
  });

  it('issues ONE cfdi query for the page, not one per row', async () => {
    wireDb();
    await list();
    expect(db.query.mock.calls.filter(c => /FROM cfdi_documents/.test(c[0]))).toHaveLength(1);
  });

  it('skips the query entirely on an empty page', async () => {
    wireDb({ notes: [] });
    const res = await list();
    expect(res.status).toBe(200);
    expect(cfdiQuery()).toBeUndefined();
  });
});
