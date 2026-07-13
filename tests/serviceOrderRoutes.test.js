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
  nextOrderNumber: jest.fn(),
  seedDefaultTasks: jest.fn(),
  startOrder: jest.fn(),
  completeOrder: jest.fn(),
  cancelOrder: jest.fn(),
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
    lifecycleService.nextOrderNumber.mockResolvedValue('SO-000001');
    lifecycleService.seedDefaultTasks.mockResolvedValue(undefined);

    const conn = {
      beginTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn()
        .mockResolvedValueOnce([{ insertId: 10 }]) // INSERT service_orders
        .mockResolvedValue([[{ id: 10, order_number: 'SO-000001', status: 'new', organization_id: 42 }]]),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
      release: jest.fn(),
    };
    db.getConnection.mockResolvedValue(conn);
    // ServiceOrder.findById (after commit) uses db.query
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('FROM `service_orders`')) {
        return Promise.resolve([[{ id: 10, order_number: 'SO-000001', status: 'new', organization_id: 42 }]]);
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
    expect(lifecycleService.nextOrderNumber).toHaveBeenCalled();
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

  // ===========================================================================
  // Bug 3 (security hardening): FK org-scoping on create/update
  // ===========================================================================
  describe('FK org-scoping (client_id/lead_id/plan_id/contract_id)', () => {
    test('POST /service-orders rejects a client_id from a different organization', async () => {
      const conn = {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      db.getConnection.mockResolvedValue(conn);
      db.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('clients') && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[]]); // Client.findById — no row in this org
        }
        if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
        }
        return Promise.resolve([[]]);
      });

      const res = await request(app)
        .post('/api/v1/service-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ client_id: 999, order_type: 'new_install' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(conn.rollback).toHaveBeenCalled();
      expect(lifecycleService.nextOrderNumber).not.toHaveBeenCalled();
    });

    test('POST /service-orders rejects a lead_id from a different organization', async () => {
      const conn = {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      db.getConnection.mockResolvedValue(conn);
      db.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('leads') && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[]]); // Lead.findById — no row in this org
        }
        if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
        }
        return Promise.resolve([[]]);
      });

      const res = await request(app)
        .post('/api/v1/service-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ lead_id: 999, order_type: 'new_install' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(conn.rollback).toHaveBeenCalled();
    });

    test('POST /service-orders rejects a plan_id belonging to a different organization with 422 PLAN_ARCHIVED', async () => {
      const conn = {
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        query: jest.fn(),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        release: jest.fn(),
      };
      db.getConnection.mockResolvedValue(conn);
      db.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('FROM plans')) {
          return Promise.resolve([[]]); // assertPlanSelectable — no live plan in this org (or global)
        }
        if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
        }
        return Promise.resolve([[]]);
      });

      const res = await request(app)
        .post('/api/v1/service-orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ plan_id: 999, order_type: 'new_install' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PLAN_ARCHIVED');
      expect(conn.rollback).toHaveBeenCalled();
    });

    test('PATCH /service-orders/:id rejects a contract_id from a different organization', async () => {
      db.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('contracts') && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[]]); // Contract.findById — no row in this org
        }
        if (typeof sql === 'string' && sql.includes('service_orders') && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 10, status: 'in_process', organization_id: 42, deleted_at: null }]]);
        }
        if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
        }
        return Promise.resolve([[]]);
      });

      const res = await request(app)
        .patch('/api/v1/service-orders/10')
        .set('Authorization', `Bearer ${token}`)
        .send({ contract_id: 999 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('PUT /service-orders/:id rejects a client_id from a different organization', async () => {
      db.query.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.includes('clients') && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[]]); // Client.findById — no row in this org
        }
        if (typeof sql === 'string' && sql.includes('service_orders') && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 10, status: 'new', organization_id: 42, deleted_at: null }]]);
        }
        if (typeof sql === 'string' && sql.includes('WHERE id = ?')) {
          return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
        }
        return Promise.resolve([[]]);
      });

      const res = await request(app)
        .put('/api/v1/service-orders/10')
        .set('Authorization', `Bearer ${token}`)
        .send({ client_id: 999, order_type: 'new_install' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  test('POST /service-orders/:id/start transitions the order and surfaces the auto-created contract', async () => {
    lifecycleService.startOrder.mockResolvedValue({
      order: { id: 10, status: 'in_process', contract_id: 77 },
      contract: { id: 77, status: 'pending' },
      provisioning: { pppoe: { username: 'client01', password: 'secret' } },
    });
    const res = await request(app)
      .post('/api/v1/service-orders/10/start')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_process');
    expect(res.body.data.contract).toEqual({ id: 77, status: 'pending' });
    expect(res.body.data.provisioning).toEqual({ pppoe: { username: 'client01', password: 'secret' } });
    expect(lifecycleService.startOrder).toHaveBeenCalledWith('10', expect.objectContaining({ orgId: 42 }));
  });

  test('POST /service-orders/:id/complete requires billing', async () => {
    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(422);
    expect(lifecycleService.completeOrder).not.toHaveBeenCalled();
  });

  test('POST /service-orders/:id/complete rejects an invalid billing value', async () => {
    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ billing: 'other' });
    expect(res.status).toBe(422);
  });

  test('POST /service-orders/:id/complete with already_paid transitions the order', async () => {
    lifecycleService.completeOrder.mockResolvedValue({ order: { id: 10, status: 'done' }, invoice: null });
    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ billing: 'already_paid' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('done');
    expect(res.body.data.invoice).toBeUndefined();
    expect(lifecycleService.completeOrder).toHaveBeenCalledWith('10', expect.objectContaining({
      orgId: 42, billing: 'already_paid', installationFee: undefined,
    }));
  });

  test('POST /service-orders/:id/complete with create_invoice passes the fee and surfaces the invoice', async () => {
    lifecycleService.completeOrder.mockResolvedValue({
      order: { id: 10, status: 'done' },
      invoice: { id: 5, invoice_number: 'INV-000005', total: 500 },
    });
    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ billing: 'create_invoice', installation_fee: 500, description: 'Install fee' });
    expect(res.status).toBe(200);
    expect(res.body.data.invoice).toEqual({ id: 5, invoice_number: 'INV-000005', total: 500 });
    expect(lifecycleService.completeOrder).toHaveBeenCalledWith('10', expect.objectContaining({
      orgId: 42, billing: 'create_invoice', installationFee: 500, description: 'Install fee',
    }));
  });

  test('POST /service-orders/:id/cancel delegates to cancelOrder and reports whether a contract was deprovisioned', async () => {
    lifecycleService.cancelOrder.mockResolvedValue({
      order: { id: 10, status: 'cancelled' },
      contractCancelled: true,
    });
    const res = await request(app)
      .post('/api/v1/service-orders/10/cancel')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
    expect(lifecycleService.cancelOrder).toHaveBeenCalledWith('10', expect.objectContaining({ orgId: 42 }));
  });

  test('GET /service-orders returns client_name/lead_name from the dedicated LEFT JOIN handler', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') && !sql.includes('service_orders')) {
        return Promise.resolve([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]]);
      }
      if (typeof sql === 'string' && sql.includes('LEFT JOIN clients')) {
        return Promise.resolve([[
          { id: 10, order_number: 'SO-000010', client_id: 50, lead_id: null, status: 'new', client_name: 'Acme Corp', lead_name: null },
          { id: 11, order_number: 'SO-000011', client_id: null, lead_id: 7, status: 'new', client_name: null, lead_name: 'Prospect Co' },
        ]]);
      }
      if (typeof sql === 'string' && sql.includes('SELECT COUNT(*) AS total FROM service_orders')) {
        return Promise.resolve([[{ total: 2 }]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .get('/api/v1/service-orders')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].client_name).toBe('Acme Corp');
    expect(res.body.data[1].lead_name).toBe('Prospect Co');
    expect(res.body.meta.total).toBe(2);
  });

  test('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/service-orders');
    expect(res.status).toBe(401);
  });
});
