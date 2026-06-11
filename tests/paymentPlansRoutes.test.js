// =============================================================================
// FireISP 5.0 — Payment Plans Route Integration Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

jest.mock('../src/services/paymentPlanService', () => ({
  createPlan: jest.fn(),
  getPlanWithInstallments: jest.fn(),
  payInstallment: jest.fn(),
  checkInstallmentsDue: jest.fn(),
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

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const paymentPlanService = require('../src/services/paymentPlanService');
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
// GET /api/v1/payment-plans
// =============================================================================
describe('GET /api/v1/payment-plans', () => {
  test('returns 200 with list of plans', async () => {
    mockAuthUser();
    const mockPlan = {
      id: 1,
      organization_id: 1,
      client_id: 5,
      total_amount: '300.00',
      installment_count: 3,
      frequency: 'monthly',
      status: 'active',
    };

    db.query
      .mockResolvedValueOnce([[mockPlan]])      // findAll
      .mockResolvedValueOnce([[{ total: 1 }]]); // count

    const res = await request(app)
      .get('/api/v1/payment-plans')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/payment-plans');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/v1/payment-plans
// =============================================================================
describe('POST /api/v1/payment-plans', () => {
  test('returns 201 with created plan', async () => {
    mockAuthUser();

    const createdResult = {
      plan: {
        id: 10,
        organization_id: 1,
        client_id: 5,
        total_amount: '300.00',
        installment_count: 3,
        frequency: 'monthly',
        status: 'active',
      },
      installments: [
        { id: 1, plan_id: 10, sequence: 1, amount: '100.00', status: 'pending' },
        { id: 2, plan_id: 10, sequence: 2, amount: '100.00', status: 'pending' },
        { id: 3, plan_id: 10, sequence: 3, amount: '100.00', status: 'pending' },
      ],
    };

    paymentPlanService.createPlan.mockResolvedValueOnce(createdResult);

    const res = await request(app)
      .post('/api/v1/payment-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        client_id: 5,
        total_amount: 300,
        installment_count: 3,
        frequency: 'monthly',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.plan.id).toBe(10);
    expect(res.body.data.installments).toHaveLength(3);
    expect(paymentPlanService.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 1,
        clientId: 5,
        totalAmount: 300,
        installmentCount: 3,
        frequency: 'monthly',
      }),
    );
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/v1/payment-plans')
      .send({ client_id: 5, total_amount: 100, installment_count: 2, frequency: 'monthly' });

    expect(res.status).toBe(401);
  });

  test('passes notes and createdBy to service', async () => {
    mockAuthUser();

    paymentPlanService.createPlan.mockResolvedValueOnce({
      plan: { id: 11, status: 'active' },
      installments: [],
    });

    await request(app)
      .post('/api/v1/payment-plans')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        client_id: 5,
        total_amount: 200,
        installment_count: 2,
        frequency: 'monthly',
        notes: 'Payment agreement',
      });

    expect(paymentPlanService.createPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: 'Payment agreement',
        createdBy: 1,
      }),
    );
  });
});

// =============================================================================
// GET /api/v1/payment-plans/:id
// =============================================================================
describe('GET /api/v1/payment-plans/:id', () => {
  test('returns 200 with plan and installments', async () => {
    mockAuthUser();

    const planWithInstallments = {
      plan: { id: 5, organization_id: 1, status: 'active', installment_count: 2 },
      installments: [
        { id: 10, sequence: 1, amount: '150.00', status: 'paid' },
        { id: 11, sequence: 2, amount: '150.00', status: 'pending' },
      ],
    };

    paymentPlanService.getPlanWithInstallments.mockResolvedValueOnce(planWithInstallments);

    const res = await request(app)
      .get('/api/v1/payment-plans/5')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.plan.id).toBe(5);
    expect(res.body.data.installments).toHaveLength(2);
    expect(paymentPlanService.getPlanWithInstallments).toHaveBeenCalledWith(5, 1);
  });

  test('returns 404 when plan not found', async () => {
    mockAuthUser();

    const { NotFoundError } = require('../src/utils/errors');
    paymentPlanService.getPlanWithInstallments.mockRejectedValueOnce(
      new NotFoundError('payment_plans'),
    );

    const res = await request(app)
      .get('/api/v1/payment-plans/999')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(404);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app).get('/api/v1/payment-plans/1');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/v1/payment-plans/:id/installments/:seq/pay
// =============================================================================
describe('POST /api/v1/payment-plans/:id/installments/:seq/pay', () => {
  test('returns 200 with updated installment', async () => {
    mockAuthUser();

    const paidInstallment = {
      id: 10,
      plan_id: 5,
      sequence: 1,
      amount: '150.00',
      status: 'paid',
      paid_payment_id: 7,
    };

    paymentPlanService.payInstallment.mockResolvedValueOnce(paidInstallment);

    const res = await request(app)
      .post('/api/v1/payment-plans/5/installments/1/pay')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ payment_id: 7 });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paid');
    expect(paymentPlanService.payInstallment).toHaveBeenCalledWith(5, 1, 7, 1);
  });

  test('returns 404 when plan not found', async () => {
    mockAuthUser();

    const { NotFoundError } = require('../src/utils/errors');
    paymentPlanService.payInstallment.mockRejectedValueOnce(
      new NotFoundError('payment_plans'),
    );

    const res = await request(app)
      .post('/api/v1/payment-plans/999/installments/1/pay')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ payment_id: 7 });

    expect(res.status).toBe(404);
  });

  test('returns 401 without auth token', async () => {
    const res = await request(app)
      .post('/api/v1/payment-plans/1/installments/1/pay')
      .send({ payment_id: 7 });

    expect(res.status).toBe(401);
  });
});
