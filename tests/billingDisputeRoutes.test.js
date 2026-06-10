// =============================================================================
// FireISP 5.0 — Billing Dispute Routes Integration Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

jest.mock('../src/utils/logger', () => {
  const mock = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mock),
  };
  return mock;
});

jest.mock('../src/services/auditLog', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

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
    id: 1, email: 'test@example.com', status: 'active', role: 'admin', organization_id: 1,
  });
}

const MOCK_DISPUTE = {
  id: 1, organization_id: 1, client_id: 5, type: 'billing_error',
  status: 'open', description: 'Incorrect charge on invoice', opened_by: 1,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/v1/billing-disputes', () => {
  test('returns 200 with list', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[MOCK_DISPUTE]])       // findAll
      .mockResolvedValueOnce([[{ total: 1 }]]);      // count

    const res = await request(app)
      .get('/api/v1/billing-disputes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

describe('POST /api/v1/billing-disputes', () => {
  test('creates a billing dispute', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[MOCK_DISPUTE]]);

    const res = await request(app)
      .post('/api/v1/billing-disputes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ client_id: 5, type: 'billing_error', description: 'Incorrect charge on invoice' });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('open');
  });

  test('returns 422 when description is missing', async () => {
    mockAuthUser();

    const res = await request(app)
      .post('/api/v1/billing-disputes')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ client_id: 5, type: 'billing_error' });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/billing-disputes/:id/transition', () => {
  test('transitions dispute status', async () => {
    mockAuthUser();
    const investigating = { ...MOCK_DISPUTE, status: 'investigating' };

    db.query
      .mockResolvedValueOnce([[MOCK_DISPUTE]])       // findByIdOrFail
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // update
      .mockResolvedValueOnce([[investigating]]);      // SELECT after update

    const res = await request(app)
      .post('/api/v1/billing-disputes/1/transition')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ status: 'investigating' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('investigating');
  });
});

describe('GET /api/v1/billing-disputes/:id/evidence', () => {
  test('returns 200 with evidence list', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[MOCK_DISPUTE]])  // findByIdOrFail
      .mockResolvedValueOnce([[{ id: 1, filename: 'doc.pdf', dispute_id: 1 }], []]); // evidence list

    const res = await request(app)
      .get('/api/v1/billing-disputes/1/evidence')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
