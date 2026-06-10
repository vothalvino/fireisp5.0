// =============================================================================
// FireISP 5.0 — Refund Request Routes Integration Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

jest.mock('../src/services/refundRequestService', () => ({
  createRequest: jest.fn(),
  reviewRequest: jest.fn(),
  processRequest: jest.fn(),
}));

jest.mock('../src/services/billingAdjustmentService', () => ({
  record: jest.fn().mockResolvedValue({ id: 1 }),
}));

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
const refundRequestService = require('../src/services/refundRequestService');
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

const MOCK_REQUEST = {
  id: 1, organization_id: 1, client_id: 5, amount: '100.00', reason: 'overcharge',
  status: 'requested', requested_by: 1,
};

beforeEach(() => {
  jest.resetAllMocks();
});

describe('GET /api/v1/refund-requests', () => {
  test('returns 200 with list', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[MOCK_REQUEST]])       // findAll
      .mockResolvedValueOnce([[{ total: 1 }]]);      // count

    const res = await request(app)
      .get('/api/v1/refund-requests')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

describe('POST /api/v1/refund-requests', () => {
  test('creates a refund request', async () => {
    mockAuthUser();
    refundRequestService.createRequest.mockResolvedValue(MOCK_REQUEST);

    const res = await request(app)
      .post('/api/v1/refund-requests')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ client_id: 5, amount: 100, reason: 'overcharge' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ id: 1, status: 'requested' });
  });

  test('returns 422 when client_id is missing', async () => {
    mockAuthUser();

    const res = await request(app)
      .post('/api/v1/refund-requests')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ amount: 100, reason: 'overcharge' });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/refund-requests/:id/review', () => {
  test('reviews a refund request successfully', async () => {
    mockAuthUser();
    const approved = { ...MOCK_REQUEST, status: 'approved', reviewed_by: 1 };
    refundRequestService.reviewRequest.mockResolvedValue(approved);

    const res = await request(app)
      .post('/api/v1/refund-requests/1/review')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ status: 'approved', review_notes: 'Looks good' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  test('returns 422 when review status is missing', async () => {
    mockAuthUser();

    const res = await request(app)
      .post('/api/v1/refund-requests/1/review')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ review_notes: 'Missing status' });

    expect(res.status).toBe(422);
  });
});

describe('POST /api/v1/refund-requests/:id/process', () => {
  test('processes a refund request', async () => {
    mockAuthUser();
    const processed = { ...MOCK_REQUEST, status: 'processed', refund_method: 'credit_balance' };
    refundRequestService.processRequest.mockResolvedValue(processed);

    const res = await request(app)
      .post('/api/v1/refund-requests/1/process')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-Org-Id', '1')
      .send({ refund_method: 'credit_balance' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('processed');
  });
});
