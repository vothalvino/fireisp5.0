// =============================================================================
// FireISP 5.0 — Service Order Route Tests (§1.2)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/lifecycleService', () => ({
  generateOrderNumber: jest.fn(),
  seedDefaultTasks: jest.fn(),
  transitionOrder: jest.fn(),
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

function mockAuth() {
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('Service order routes (§1.2)', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth();
  });

  test('POST /service-orders generates an order number and seeds tasks', async () => {
    lifecycleService.generateOrderNumber.mockResolvedValue('SO-000001');
    lifecycleService.seedDefaultTasks.mockResolvedValue(undefined);

    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ insertId: 10 }]) // INSERT service_orders
        .mockResolvedValue([[{ id: 10, order_number: 'SO-000001', status: 'requested', organization_id: 42 }]]),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);
    // ServiceOrder.findById (after commit) uses db.query
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('FROM `service_orders`')) {
        return Promise.resolve([[{ id: 10, order_number: 'SO-000001', status: 'requested', organization_id: 42 }]]);
      }
      if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
        return Promise.resolve([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .post('/api/v1/service-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 50, plan_id: 2, order_type: 'new_install' });

    expect(res.status).toBe(201);
    expect(lifecycleService.generateOrderNumber).toHaveBeenCalled();
    expect(lifecycleService.seedDefaultTasks).toHaveBeenCalledWith(conn, 10);
    expect(conn.commit).toHaveBeenCalled();
  });

  test('POST /service-orders rejects an invalid order_type', async () => {
    const res = await request(app)
      .post('/api/v1/service-orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 50, order_type: 'teleport' });
    expect(res.status).toBe(422);
  });

  test('POST /service-orders/:id/approve transitions the order', async () => {
    lifecycleService.transitionOrder.mockResolvedValue({ id: 10, status: 'approved' });
    const res = await request(app)
      .post('/api/v1/service-orders/10/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    expect(lifecycleService.transitionOrder).toHaveBeenCalledWith('10', 'approved', expect.objectContaining({ orgId: 42 }));
  });

  test('POST /service-orders/:id/activate passes the contract id', async () => {
    lifecycleService.transitionOrder.mockResolvedValue({ id: 10, status: 'activated', contract_id: 77 });
    const res = await request(app)
      .post('/api/v1/service-orders/10/activate')
      .set('Authorization', `Bearer ${token}`)
      .send({ contract_id: 77 });
    expect(res.status).toBe(200);
    expect(lifecycleService.transitionOrder).toHaveBeenCalledWith('10', 'activated', expect.objectContaining({ contractId: 77 }));
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/service-orders');
    expect(res.status).toBe(401);
  });
});
