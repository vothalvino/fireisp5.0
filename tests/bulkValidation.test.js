// =============================================================================
// FireISP 5.0 — Bulk Validation Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// POST /api/bulk/invoices/generate
// =============================================================================
describe('POST /api/bulk/invoices/generate', () => {
  test('rejects empty body → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects non-array contract_ids → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('valid contract_ids → 200', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);

    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [1, 2, 3] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(3);
  });

  test('rejects >500 contracts → 400', async () => {
    mockAuthUser();
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: ids });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/500/);
  });
});

// =============================================================================
// POST /api/bulk/suspend
// =============================================================================
describe('POST /api/bulk/suspend', () => {
  test('rejects empty body → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('valid body → 200', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);

    const res = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [10, 20], reason: 'Non-payment' });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(2);
  });
});

// =============================================================================
// POST /api/bulk/email
// =============================================================================
describe('POST /api/bulk/email', () => {
  test('missing subject → 422', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], body: 'Hello' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('missing body → 422', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], subject: 'Hi' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('valid data → 200', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[
      { id: 1, email: 'client@example.com', first_name: 'John', last_name: 'Doe' },
    ]]);

    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], subject: 'Notice', body: 'Service update' });

    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(1);
  });

  test('subject too long (>500 chars) → 422', async () => {
    mockAuthUser();
    const longSubject = 'x'.repeat(501);
    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], subject: longSubject, body: 'Hello' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
