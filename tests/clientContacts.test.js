// =============================================================================
// FireISP 5.0 — Client contact creation regression
// =============================================================================
// POST /clients/:id/contacts inserted into a non-existent `name` column and
// 500'd ("Unknown column 'name'"). The contacts table stores first_name +
// last_name (both NOT NULL); the handler now splits the UI's single `name`.
// (Mocked-DB unit tests can't catch the original schema mismatch, so this
// locks the corrected column list + the name-split behaviour.)
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const app = require('../src/app');

const token = jwt.sign(
  { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
  config.jwt.secret,
  { expiresIn: '1h' },
);

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.startsWith('SELECT * FROM contacts')) {
      return Promise.resolve([[{ id: 999, first_name: 'Ada', last_name: 'Lovelace' }]]);
    }
    if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT INTO contacts')) {
      return Promise.resolve([{ insertId: 999 }]);
    }
    return Promise.resolve([[]]);
  });
});

describe('POST /clients/:id/contacts', () => {
  test('splits a two-part name into first_name + last_name (no "name" column)', async () => {
    const res = await request(app)
      .post('/api/v1/clients/5/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', role: 'Billing' });

    expect(res.status).toBe(201);
    const insert = db.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO contacts'));
    expect(insert).toBeDefined();
    expect(insert[0]).toContain('first_name, last_name');
    expect(insert[0]).not.toMatch(/\(client_id, name,/);
    expect(insert[1]).toEqual(['5', 'Ada', 'Lovelace', 'ada@example.com', null, 'Billing']);
  });

  test('handles a single-word name (last_name = "")', async () => {
    const res = await request(app)
      .post('/api/v1/clients/5/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Madonna' });

    expect(res.status).toBe(201);
    const insert = db.query.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO contacts'));
    expect(insert[1]).toEqual(['5', 'Madonna', '', null, null, null]);
  });
});
