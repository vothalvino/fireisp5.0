// =============================================================================
// FireISP 5.0 — Client Profile Route Validation Tests (§1.1)
// =============================================================================
// Verifies validation on the new subscriber-profile endpoints. Uses supertest
// against the real Express app with a mocked database (same approach as
// routeValidation.test.js).
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

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function mockDb() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
    }
    if (typeof sql === 'string' && sql.includes('INSERT')) {
      return Promise.resolve([{ insertId: 999 }]);
    }
    if (typeof sql === 'string' && sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 0 }]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('Client profile validation (§1.1)', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb();
  });

  test('POST /clients accepts corporate type, credit_score and risk_rating', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Corp', client_type: 'corporate', credit_score: 720, risk_rating: 'low' });
    expect(res.status).not.toBe(422);
  });

  test('POST /clients rejects an invalid risk_rating', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Risk', risk_rating: 'extreme' });
    expect(res.status).toBe(422);
  });

  test('POST /clients rejects a credit_score above 1000', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Too High', credit_score: 2000 });
    expect(res.status).toBe(422);
  });

  test('POST /clients rejects an out-of-range latitude', async () => {
    const res = await request(app)
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Geo', latitude: 200 });
    expect(res.status).toBe(422);
  });

  test('PUT /clients/:id/custom-fields requires field_key', async () => {
    const res = await request(app)
      .put('/api/v1/clients/1/custom-fields')
      .set('Authorization', `Bearer ${token}`)
      .send({ field_value: 'orphan value' });
    expect(res.status).toBe(422);
  });

  test('POST /clients/:id/merge requires source_id', async () => {
    const res = await request(app)
      .post('/api/v1/clients/1/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(422);
  });

  test('POST /client-groups rejects an invalid billing_mode', async () => {
    const res = await request(app)
      .post('/api/v1/client-groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Family', billing_mode: 'bogus' });
    expect(res.status).toBe(422);
  });
});
