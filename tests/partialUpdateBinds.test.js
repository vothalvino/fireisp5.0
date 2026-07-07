// =============================================================================
// FireISP 5.0 — Partial-PUT bind-parameter guard
// =============================================================================
// Several PUT handlers use `COALESCE(?, col)` with raw destructured binds. When
// the client omits a field it is `undefined`, which mysql2's execute() rejects
// ("Bind parameters must not contain undefined") — so a partial update 500'd.
// The fix coalesces each optional bind to null. This asserts no `undefined`
// value ever reaches db.query for a partial reseller update.

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

const TOKEN = jwt.sign(
  { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

const RESELLER = { id: 5, organization_id: 42, name: 'Acme', status: 'active', deleted_at: null };

beforeEach(() => { jest.clearAllMocks(); });

describe('PUT /resellers/:id — partial body sends no undefined binds', () => {
  test('omitting most fields does not put undefined into the UPDATE params', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && /WHERE id = \?/.test(sql) && !/resellers/.test(sql)) {
        return Promise.resolve([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]]);
      }
      if (typeof sql === 'string' && /SELECT .* FROM resellers/i.test(sql)) {
        return Promise.resolve([[RESELLER]]);
      }
      if (typeof sql === 'string' && /UPDATE resellers/i.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .put('/api/v1/resellers/5')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ status: 'suspended' }); // partial — every other field omitted

    expect(res.status).toBe(200);

    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && /UPDATE resellers/i.test(c[0]),
    );
    expect(updateCall).toBeTruthy();
    // The bug: omitted fields arrived as `undefined`. Guard against any recurrence.
    expect(updateCall[1]).not.toContain(undefined);
    // The provided field is still bound.
    expect(updateCall[1]).toContain('suspended');
  });
});
