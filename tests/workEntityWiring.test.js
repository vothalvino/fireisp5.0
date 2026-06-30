// =============================================================================
// FireISP 5.0 — Work-entity wiring tests
// Covers:
//   A. GET /work-orders?ticket_id= and ?service_order_id= filters
//   B. POST /work-orders stores ticket_id
//   C. PATCH /service-orders/:id links contract_id
//   D. GET /escalations?ticket_id= filter (via crudController + BaseModel)
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
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const TOKEN = adminToken();

function authMock() {
  // First db.query call in authenticated routes is the user lookup
  db.query.mockImplementation((sql) => {
    if (typeof sql === 'string' && /WHERE id = \?/.test(sql) && !/work_orders/.test(sql)) {
      return Promise.resolve([[{ id: 1, email: 'admin@example.com', role: 'admin', status: 'active', organization_id: 42 }]]);
    }
    return Promise.resolve([[]]);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// A. Work-order list — ticket_id filter
// ---------------------------------------------------------------------------
describe('GET /work-orders — ticket_id filter', () => {
  test('passes ticket_id as a WHERE clause parameter', async () => {
    // auth → rows → count
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]])
      .mockResolvedValueOnce([[{ id: 5, title: 'Fix CPE', ticket_id: 99, status: 'pending', work_type: 'repair' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const res = await request(app)
      .get('/api/v1/work-orders?ticket_id=99')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    // The SELECT query should have used the ticket_id bind value
    const rowsCall = db.query.mock.calls.find(
      c => typeof c[0] === 'string' && /FROM work_orders wo/.test(c[0]),
    );
    expect(rowsCall).toBeTruthy();
    expect(rowsCall[1]).toContain('99');
  });
});

// ---------------------------------------------------------------------------
// A. Work-order list — service_order_id filter
// ---------------------------------------------------------------------------
describe('GET /work-orders — service_order_id filter', () => {
  test('passes service_order_id as a WHERE clause parameter', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]])
      .mockResolvedValueOnce([[{ id: 7, title: 'Install fiber', service_order_id: 55, status: 'pending', work_type: 'installation' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const res = await request(app)
      .get('/api/v1/work-orders?service_order_id=55')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    const rowsCall = db.query.mock.calls.find(
      c => typeof c[0] === 'string' && /FROM work_orders wo/.test(c[0]),
    );
    expect(rowsCall).toBeTruthy();
    expect(rowsCall[1]).toContain('55');
  });
});

// ---------------------------------------------------------------------------
// B. POST /work-orders — ticket_id stored
// ---------------------------------------------------------------------------
describe('POST /work-orders — ticket_id wiring', () => {
  test('creates a work order with ticket_id and client_id', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]])
      .mockResolvedValueOnce([{ insertId: 10 }])  // INSERT
      .mockResolvedValueOnce([[{                   // SELECT after insert
        id: 10, ticket_id: 99, client_id: 3,
        title: 'Fix at client site', status: 'pending', work_type: 'repair',
      }]]);

    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        ticket_id: 99,
        client_id: 3,
        title: 'Fix at client site',
        work_type: 'repair',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.ticket_id).toBe(99);

    const insertCall = db.query.mock.calls.find(
      c => typeof c[0] === 'string' && /INSERT INTO work_orders/.test(c[0]),
    );
    expect(insertCall).toBeTruthy();
    // ticket_id value should appear in INSERT params
    expect(insertCall[1]).toContain(99);
  });
});

// ---------------------------------------------------------------------------
// C. PATCH /service-orders/:id — contract_id linking
// ---------------------------------------------------------------------------
describe('PATCH /service-orders/:id — contract_id linking', () => {
  test('sets contract_id on the service order', async () => {
    const existing = { id: 10, status: 'provisioning', client_id: 3, organization_id: 42, deleted_at: null };
    const updated  = { ...existing, contract_id: 77 };

    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]])  // auth
      .mockResolvedValueOnce([[existing]])  // findByIdOrFail (before update)
      .mockResolvedValueOnce([[existing]])  // findAll in update (BaseModel)
      .mockResolvedValueOnce([[updated]]);  // SELECT after update

    // BaseModel.update uses multiple queries — mock them generically
    db.query.mockImplementation((sql, params) => {
      if (/WHERE id = \?/.test(sql) && !/UPDATE/.test(sql) && !/INSERT/.test(sql)) {
        return Promise.resolve([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]]);
      }
      if (/FROM `service_orders`/.test(sql)) {
        return Promise.resolve([[existing]]);
      }
      if (/UPDATE `service_orders`/.test(sql)) {
        return Promise.resolve([{ affectedRows: 1 }]);
      }
      if (/SELECT \* FROM `service_orders` WHERE id/.test(sql)) {
        return Promise.resolve([[updated]]);
      }
      return Promise.resolve([[]]);
    });

    const res = await request(app)
      .patch('/api/v1/service-orders/10')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ contract_id: 77 });

    expect(res.status).toBe(200);
    // Response should contain the updated service order
    expect(res.body.data).toBeDefined();

    // The UPDATE query must include contract_id binding with value 77
    const updateCall = db.query.mock.calls.find(
      c => typeof c[0] === 'string' && /UPDATE `service_orders`/.test(c[0]),
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toContain(77);
  });
});

// ---------------------------------------------------------------------------
// D. GET /escalations?ticket_id= — filter via crudController + BaseModel
// ---------------------------------------------------------------------------
describe('GET /escalations — ticket_id filter', () => {
  test('returns escalations filtered by ticket_id', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, role: 'admin', status: 'active', organization_id: 42 }]])  // auth
      .mockResolvedValueOnce([[{                                                                      // rows
        id: 3, ticket_id: 99, level: 1, reason: 'SLA breach', status: 'open', organization_id: 42,
      }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);                                                      // count

    const res = await request(app)
      .get('/api/v1/escalations?ticket_id=99')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);

    // The query should have filtered by ticket_id
    const rowsCall = db.query.mock.calls.find(
      c => typeof c[0] === 'string' && /ticket_escalations/.test(c[0]) && !/FROM users/.test(c[0]),
    );
    expect(rowsCall).toBeTruthy();
    expect(rowsCall[1]).toContain('99');
  });
});
