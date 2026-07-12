// =============================================================================
// FireISP 5.0 — Lead Route Tests (§1.2)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/lifecycleService', () => ({
  convertLead: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const lifecycleService = require('../src/services/lifecycleService');
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
    if (typeof sql === 'string' && sql.includes('GROUP BY status')) {
      return Promise.resolve([[{ status: 'new', count: 3 }, { status: 'won', count: 1 }]]);
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

describe('Lead routes (§1.2)', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb();
  });

  test('POST /leads accepts a valid lead', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Prospect', source: 'referral', status: 'new', estimated_value: 350 });
    expect(res.status).not.toBe(422);
  });

  test('POST /leads rejects an invalid source', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Source', source: 'carrier-pigeon' });
    expect(res.status).toBe(422);
  });

  test('POST /leads rejects an invalid pipeline status', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Status', status: 'maybe' });
    expect(res.status).toBe(422);
  });

  test('POST /leads requires a name', async () => {
    const res = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'website' });
    expect(res.status).toBe(422);
  });

  test('GET /leads/pipeline returns stage counts', async () => {
    const res = await request(app)
      .get('/api/v1/leads/pipeline')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ new: 3, won: 1 });
  });

  test('POST /leads/:id/convert delegates to lifecycleService', async () => {
    lifecycleService.convertLead.mockResolvedValue({ lead: { id: 5, status: 'won' }, client: { id: 99 } });
    const res = await request(app)
      .post('/api/v1/leads/5/convert')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_type: 'business' });
    expect(res.status).toBe(201);
    expect(res.body.data.client.id).toBe(99);
    expect(lifecycleService.convertLead).toHaveBeenCalledWith('5', 42, { client_type: 'business' });
  });

  test('GET /leads?search= uses the dedicated search handler (partial name/email/phone/company, exact id)', async () => {
    db.query.mockImplementation((sql, params) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]]);
      }
      // Check the COUNT query BEFORE the generic row query — both contain
      // "LIKE ?" in their WHERE clause.
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) AS total FROM leads')) {
        return Promise.resolve([[{ total: 1 }]]);
      }
      if (typeof sql === 'string' && sql.includes('LIKE ?')) {
        expect(sql).toContain('name LIKE ?');
        expect(sql).toContain('company LIKE ?');
        expect(params).toContain('%acme%');
        return Promise.resolve([[{ id: 5, name: 'Acme Prospect', email: 'a@x.com', status: 'new' }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/leads?search=acme')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Acme Prospect');
    expect(res.body.meta.total).toBe(1);
  });

  test('GET /leads without a search term falls through to the generic crudController list (unchanged)', async () => {
    const res = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/leads');
    expect(res.status).toBe(401);
  });
});
