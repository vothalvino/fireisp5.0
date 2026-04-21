// =============================================================================
// FireISP 5.0 — Contract Suspend / Unsuspend Route Tests
// =============================================================================
// Covers POST /api/contracts/:id/suspend and POST /api/contracts/:id/unsuspend.
// These endpoints call suspensionService which sends RADIUS CoA Disconnect /
// CoA-Request to immediately kick or re-enable the subscriber's active session.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/suspensionService');
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
const suspensionService = require('../src/services/suspensionService');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const authToken = makeToken();

function mockAuthUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'admin@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// POST /api/contracts/:id/suspend
// =============================================================================
describe('POST /api/contracts/:id/suspend', () => {
  test('suspends an active contract and calls suspensionService', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]]);
    suspensionService.suspendContract.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/api/contracts/5/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.contract_id).toBe(5);
    expect(res.body.data.status).toBe('suspended');
    expect(suspensionService.suspendContract).toHaveBeenCalledWith(5, null, 1, null);
  });

  test('passes rule_id and invoice_id to suspensionService when provided', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 7, status: 'active', organization_id: 1 }]]);
    suspensionService.suspendContract.mockResolvedValueOnce(undefined);

    await request(app)
      .post('/api/contracts/7/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ rule_id: 3, invoice_id: 42 });

    expect(suspensionService.suspendContract).toHaveBeenCalledWith(7, 3, 1, 42);
  });

  test('returns 404 when contract not found', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]); // no contract rows

    const res = await request(app)
      .post('/api/contracts/999/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(suspensionService.suspendContract).not.toHaveBeenCalled();
  });

  test('returns 422 when contract is already suspended', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 5, status: 'suspended', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/contracts/5/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ALREADY_SUSPENDED');
    expect(suspensionService.suspendContract).not.toHaveBeenCalled();
  });

  test('returns 401 without a valid auth token', async () => {
    const res = await request(app)
      .post('/api/contracts/5/suspend')
      .send({});

    expect(res.status).toBe(401);
  });

  test('propagates errors from suspensionService', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]]);
    suspensionService.suspendContract.mockRejectedValueOnce(new Error('DB error'));

    const res = await request(app)
      .post('/api/contracts/5/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(500);
  });
});

// =============================================================================
// POST /api/contracts/:id/unsuspend
// =============================================================================
describe('POST /api/contracts/:id/unsuspend', () => {
  test('unsuspends a suspended contract and calls suspensionService', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 5, status: 'suspended', organization_id: 1 }]]);
    suspensionService.reconnectContract.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/api/contracts/5/unsuspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.contract_id).toBe(5);
    expect(res.body.data.status).toBe('active');
    expect(suspensionService.reconnectContract).toHaveBeenCalledWith(5, 1, null);
  });

  test('passes invoice_id to suspensionService when provided', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 8, status: 'suspended', organization_id: 1 }]]);
    suspensionService.reconnectContract.mockResolvedValueOnce(undefined);

    await request(app)
      .post('/api/contracts/8/unsuspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ invoice_id: 55 });

    expect(suspensionService.reconnectContract).toHaveBeenCalledWith(8, 1, 55);
  });

  test('returns 404 when contract not found', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[]]); // no contract rows

    const res = await request(app)
      .post('/api/contracts/999/unsuspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(suspensionService.reconnectContract).not.toHaveBeenCalled();
  });

  test('returns 422 when contract is not suspended', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 5, status: 'active', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/contracts/5/unsuspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_SUSPENDED');
    expect(suspensionService.reconnectContract).not.toHaveBeenCalled();
  });

  test('returns 401 without a valid auth token', async () => {
    const res = await request(app)
      .post('/api/contracts/5/unsuspend')
      .send({});

    expect(res.status).toBe(401);
  });

  test('propagates errors from suspensionService', async () => {
    mockAuthUser();
    db.query.mockResolvedValueOnce([[{ id: 5, status: 'suspended', organization_id: 1 }]]);
    suspensionService.reconnectContract.mockRejectedValueOnce(new Error('CoA failed'));

    const res = await request(app)
      .post('/api/contracts/5/unsuspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(500);
  });
});
