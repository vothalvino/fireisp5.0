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
jest.mock('../src/services/auditLog', () => ({ log: jest.fn().mockResolvedValue(undefined) }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const ServiceOrder = require('../src/models/ServiceOrder');
const User = require('../src/models/User');
const lifecycleService = require('../src/services/lifecycleService');
const auditLog = require('../src/services/auditLog');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

function technicianToken() {
  return jwt.sign(
    { sub: 2, email: 'tech@example.com', role: 'technician', orgId: 42 },
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

  afterEach(() => jest.restoreAllMocks());

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
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'new_install', status: 'in_process', organization_id: 42,
    });
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
      canActivateContract: true, canCreateInvoice: true,
    }));
  });

  test('new-install completion preserves the post-commit network warning and retry identifiers', async () => {
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'new_install', status: 'in_process', organization_id: 42,
    });
    const activation = {
      contract_id: 77,
      nas_pushed: false,
      nas_push_error: 'connect ETIMEDOUT',
    };
    lifecycleService.completeOrder.mockResolvedValue({
      order: { id: 10, status: 'done', contract_id: 77 },
      invoice: null,
      activation,
    });

    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ billing: 'already_paid' });

    expect(res.status).toBe(200);
    expect(res.body.data.activation).toEqual(activation);
    expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({
      newValues: expect.objectContaining({ activation }),
    }));
  });

  test('POST /service-orders/:id/complete with create_invoice passes the fee and surfaces the invoice', async () => {
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'new_install', status: 'in_process', organization_id: 42,
    });
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
      canActivateContract: true, canCreateInvoice: true,
    }));
  });

  test('a technician with only service_orders.update cannot permanently activate a new installation', async () => {
    const tech = technicianToken();
    db.query.mockImplementation(async (sql) => {
      if (/`users`/.test(String(sql))) {
        return [[{
          id: 2, email: 'tech@example.com', role: 'technician', status: 'active',
          organization_id: 42,
        }]];
      }
      return [[]];
    });
    jest.spyOn(User, 'getPermissions').mockResolvedValue(['service_orders.update']);
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'new_install', status: 'in_process', organization_id: 42,
    });

    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${tech}`)
      .send({ billing: 'already_paid' });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/contracts\.update/i);
    expect(lifecycleService.completeOrder).not.toHaveBeenCalled();
  });

  test('service_orders.update still completes an ordinary non-install order', async () => {
    const tech = technicianToken();
    db.query.mockImplementation(async (sql) => {
      if (/`users`/.test(String(sql))) {
        return [[{
          id: 2, email: 'tech@example.com', role: 'technician', status: 'active',
          organization_id: 42,
        }]];
      }
      return [[]];
    });
    jest.spyOn(User, 'getPermissions').mockResolvedValue(['service_orders.update']);
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'upgrade', status: 'in_process', organization_id: 42,
    });
    lifecycleService.completeOrder.mockResolvedValue({
      order: { id: 10, order_type: 'upgrade', status: 'done' }, invoice: null,
    });

    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${tech}`)
      .send({ billing: 'already_paid' });

    expect(res.status).toBe(200);
    expect(lifecycleService.completeOrder).toHaveBeenCalledWith(
      '10', expect.objectContaining({ canActivateContract: false, canCreateInvoice: true }),
    );
  });

  test('creating an invoice during completion requires invoices.create', async () => {
    const tech = technicianToken();
    db.query.mockImplementation(async (sql) => {
      if (/`users`/.test(String(sql))) {
        return [[{
          id: 2, email: 'tech@example.com', role: 'technician', status: 'active',
          organization_id: 42,
        }]];
      }
      return [[]];
    });
    jest.spyOn(User, 'getPermissions').mockResolvedValue(['service_orders.update']);
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'upgrade', status: 'in_process', organization_id: 42,
    });

    const res = await request(app)
      .post('/api/v1/service-orders/10/complete')
      .set('Authorization', `Bearer ${tech}`)
      .send({ billing: 'create_invoice', installation_fee: 500 });

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/invoices\.create/i);
    expect(lifecycleService.completeOrder).not.toHaveBeenCalled();
  });

  test('POST /service-orders/:id/cancel delegates to cancelOrder and reports whether a contract was deprovisioned', async () => {
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'new_install', status: 'in_process', organization_id: 42,
    });
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
    expect(lifecycleService.cancelOrder).toHaveBeenCalledWith('10', expect.objectContaining({
      orgId: 42, canCancelContract: true,
    }));
  });

  test('service_orders.update alone cannot cancel a new installation and its pending contract', async () => {
    const tech = technicianToken();
    db.query.mockImplementation(async (sql) => {
      if (/`users`/.test(String(sql))) {
        return [[{
          id: 2, email: 'tech@example.com', role: 'technician', status: 'active',
          organization_id: 42,
        }]];
      }
      return [[]];
    });
    jest.spyOn(User, 'getPermissions').mockResolvedValue(['service_orders.update']);
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'new_install', status: 'in_process', organization_id: 42,
    });

    const res = await request(app)
      .post('/api/v1/service-orders/10/cancel')
      .set('Authorization', `Bearer ${tech}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/contracts\.update/i);
    expect(lifecycleService.cancelOrder).not.toHaveBeenCalled();
  });

  test('service_orders.update still cancels an ordinary non-install order', async () => {
    const tech = technicianToken();
    db.query.mockImplementation(async (sql) => {
      if (/`users`/.test(String(sql))) {
        return [[{
          id: 2, email: 'tech@example.com', role: 'technician', status: 'active',
          organization_id: 42,
        }]];
      }
      return [[]];
    });
    jest.spyOn(User, 'getPermissions').mockResolvedValue(['service_orders.update']);
    jest.spyOn(ServiceOrder, 'findByIdOrFail').mockResolvedValue({
      id: 10, order_type: 'repair', status: 'in_process', organization_id: 42,
    });
    lifecycleService.cancelOrder.mockResolvedValue({
      order: { id: 10, order_type: 'repair', status: 'cancelled' },
      contractCancelled: false,
    });

    const res = await request(app)
      .post('/api/v1/service-orders/10/cancel')
      .set('Authorization', `Bearer ${tech}`)
      .send({});

    expect(res.status).toBe(200);
    expect(lifecycleService.cancelOrder).toHaveBeenCalledWith('10', expect.objectContaining({
      canCancelContract: false,
    }));
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
