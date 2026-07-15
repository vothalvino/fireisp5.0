// =============================================================================
// FireISP 5.0 — Chargeback Routes Integration Tests
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

const MOCK_CHARGEBACK = {
  id: 1, organization_id: 1, payment_id: 20, gateway: 'stripe',
  gateway_dispute_id: 'dp_test_123', amount: '100.00', currency: 'USD',
  status: 'received',
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/v1/chargebacks', () => {
  test('returns 200 with list', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[MOCK_CHARGEBACK]])    // findAll
      .mockResolvedValueOnce([[{ total: 1 }]]);      // count

    const res = await request(app)
      .get('/api/v1/chargebacks')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

describe('POST /api/v1/chargebacks', () => {
  test('creates a chargeback manually', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[MOCK_CHARGEBACK]]);

    const res = await request(app)
      .post('/api/v1/chargebacks')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ amount: 100, currency: 'USD', payment_id: 20 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('received');
  });

  test('returns 422 when amount is missing', async () => {
    mockAuthUser();

    const res = await request(app)
      .post('/api/v1/chargebacks')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ currency: 'USD' });

    expect(res.status).toBe(422);
  });

  // NOTE: createChargebackSchema declares `currency` as required, so a
  // request that omits it 422s before the handler runs — the route's
  // `req.body.currency || await Organization.getCurrency(req.orgId)` default
  // (added alongside the other currency-default fixes in this PR) is
  // currently unreachable via this endpoint; it's defense-in-depth only,
  // matching the same "never hardcode USD" rule applied everywhere else.
});

describe('PUT /api/v1/chargebacks/:id', () => {
  test('updates chargeback status', async () => {
    mockAuthUser();
    const updated = { ...MOCK_CHARGEBACK, status: 'evidence_submitted' };
    db.query
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE in Chargeback.update
      .mockResolvedValueOnce([[updated]]);           // findById after update

    const res = await request(app)
      .put('/api/v1/chargebacks/1')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ status: 'evidence_submitted' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('evidence_submitted');
  });
});
