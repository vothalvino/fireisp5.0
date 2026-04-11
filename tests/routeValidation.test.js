// =============================================================================
// FireISP 5.0 — Route Validation Integration Tests
// =============================================================================
// Tests that validation middleware properly rejects invalid input on
// all core routes. Uses supertest against the real Express app with
// mocked database.
// =============================================================================

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');

// Mock the database module before requiring app
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

const db = require('../src/config/database');
const app = require('../src/app');

// Helper: generate a valid JWT token for an admin user
function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@example.com', role: 'admin', orgId: 42 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

// Helper: mock User.findById for auth middleware
function mockAuthUser() {
  db.query.mockImplementation((sql) => {
    if (sql.includes('WHERE id = ?')) {
      return Promise.resolve([[{
        id: 1, email: 'admin@example.com', role: 'admin',
        status: 'active', organization_id: 42,
      }]]);
    }
    if (sql.includes('WHERE email = ?')) {
      return Promise.resolve([[{
        id: 1, email: 'admin@example.com', role: 'admin',
        status: 'active', organization_id: 42,
      }]]);
    }
    // Default: return empty or insertId for write ops
    if (sql.includes('INSERT')) {
      return Promise.resolve([{ insertId: 999 }]);
    }
    if (sql.includes('COUNT(*)')) {
      return Promise.resolve([[{ total: 0 }]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('Route Validation — Clients', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser();
  });

  test('POST /api/clients without name returns 422', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'test@example.com' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /api/clients with invalid client_type returns 422', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Client', client_type: 'invalid_type' });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'client_type' }),
      ]),
    );
  });

  test('POST /api/clients with valid data passes validation', async () => {
    const res = await request(app)
      .post('/api/clients')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Valid Client', client_type: 'residential', status: 'active' });
    // Should not be 422 (may be 201 or a DB error, but not validation)
    expect(res.status).not.toBe(422);
  });

  test('PUT /api/clients/:id with invalid email returns 422', async () => {
    const res = await request(app)
      .put('/api/clients/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  test('POST /api/clients/:id/contacts without name returns 422', async () => {
    const res = await request(app)
      .post('/api/clients/1/contacts')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'contact@example.com' });
    expect(res.status).toBe(422);
  });

  test('PUT /api/clients/:id/mx-profile without rfc returns 422', async () => {
    const res = await request(app)
      .put('/api/clients/1/mx-profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ razon_social: 'Test SA' });
    expect(res.status).toBe(422);
  });
});

describe('Route Validation — Contracts', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser();
  });

  test('POST /api/contracts without client_id returns 422', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan_id: 1, start_date: '2026-01-01' });
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'client_id' }),
      ]),
    );
  });

  test('POST /api/contracts without plan_id returns 422', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 1, start_date: '2026-01-01' });
    expect(res.status).toBe(422);
  });

  test('POST /api/contracts with invalid connection_type returns 422', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 1, plan_id: 1, start_date: '2026-01-01', connection_type: 'fiber' });
    expect(res.status).toBe(422);
  });

  test('POST /api/contracts with valid data passes validation', async () => {
    const res = await request(app)
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 1, plan_id: 1, start_date: '2026-01-01', connection_type: 'pppoe' });
    expect(res.status).not.toBe(422);
  });

  test('POST /api/contracts/:id/addons without plan_addon_id returns 422', async () => {
    const res = await request(app)
      .post('/api/contracts/1/addons')
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 2 });
    expect(res.status).toBe(422);
  });
});

describe('Route Validation — Invoices', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser();
  });

  test('POST /api/invoices without client_id returns 422', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ subtotal: 500, total: 500, due_date: '2026-04-30' });
    expect(res.status).toBe(422);
  });

  test('POST /api/invoices without required fields returns 422', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 1 });
    expect(res.status).toBe(422);
  });

  test('POST /api/invoices with invalid status returns 422', async () => {
    const res = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 1, subtotal: 500, total: 500, due_date: '2026-04-30', status: 'bogus' });
    expect(res.status).toBe(422);
  });

  test('POST /api/invoices/:id/items without description returns 422', async () => {
    const res = await request(app)
      .post('/api/invoices/1/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 1, unit_price: 100, amount: 100 });
    expect(res.status).toBe(422);
  });

  test('POST /api/invoices/generate without contract_id returns 422', async () => {
    const res = await request(app)
      .post('/api/invoices/generate')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('Route Validation — Payments', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser();
  });

  test('POST /api/payments without client_id returns 422', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 500 });
    expect(res.status).toBe(422);
  });

  test('POST /api/payments without amount returns 422', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 1 });
    expect(res.status).toBe(422);
  });

  test('POST /api/payments with invalid payment_method returns 422', async () => {
    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ client_id: 1, amount: 500, payment_method: 'bitcoin' });
    expect(res.status).toBe(422);
  });

  test('POST /api/payments/:id/allocate without invoice_id returns 422', async () => {
    const res = await request(app)
      .post('/api/payments/1/allocate')
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 500 });
    expect(res.status).toBe(422);
  });

  test('POST /api/payments/:id/allocate without amount returns 422', async () => {
    const res = await request(app)
      .post('/api/payments/1/allocate')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoice_id: 1 });
    expect(res.status).toBe(422);
  });
});

describe('Route Validation — Devices', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser();
  });

  test('POST /api/devices without name returns 422', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'router' });
    expect(res.status).toBe(422);
  });

  test('POST /api/devices without type returns 422', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Router-01' });
    expect(res.status).toBe(422);
  });

  test('POST /api/devices with invalid type returns 422', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Router-01', type: 'modem' });
    expect(res.status).toBe(422);
  });

  test('POST /api/devices with invalid snmp_version returns 422', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Router-01', type: 'router', snmp_version: 'v4' });
    expect(res.status).toBe(422);
  });

  test('POST /api/devices with valid data passes validation', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Router-01', type: 'router', snmp_version: 'v2c' });
    expect(res.status).not.toBe(422);
  });
});

describe('Route Validation — Tickets', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser();
  });

  test('POST /api/tickets without subject returns 422', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'high' });
    expect(res.status).toBe(422);
  });

  test('POST /api/tickets with invalid priority returns 422', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Network down', priority: 'urgent' });
    expect(res.status).toBe(422);
  });

  test('POST /api/tickets with valid data passes validation', async () => {
    const res = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Network down', priority: 'critical' });
    expect(res.status).not.toBe(422);
  });

  test('POST /api/tickets/:id/comments without body returns 422', async () => {
    const res = await request(app)
      .post('/api/tickets/1/comments')
      .set('Authorization', `Bearer ${token}`)
      .send({ is_internal: true });
    expect(res.status).toBe(422);
  });

  test('POST /api/tickets/:id/comments with valid data passes', async () => {
    const res = await request(app)
      .post('/api/tickets/1/comments')
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'This is a comment', is_internal: false });
    expect(res.status).not.toBe(422);
  });
});

describe('Route Validation — Plans', () => {
  const token = adminToken();

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthUser();
  });

  test('POST /api/plans without name returns 422', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ download_speed_mbps: 50, upload_speed_mbps: 10, price: 500 });
    expect(res.status).toBe(422);
  });

  test('POST /api/plans without download_speed_mbps returns 422', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Basic', upload_speed_mbps: 10, price: 500 });
    expect(res.status).toBe(422);
  });

  test('POST /api/plans with invalid billing_cycle returns 422', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Basic', download_speed_mbps: 50, upload_speed_mbps: 10, price: 500, billing_cycle: 'weekly' });
    expect(res.status).toBe(422);
  });

  test('POST /api/plans with valid data passes validation', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Basic 50', download_speed_mbps: 50, upload_speed_mbps: 10, price: 500 });
    expect(res.status).not.toBe(422);
  });

  test('POST /api/plans/addons without name returns 422', async () => {
    const res = await request(app)
      .post('/api/plans/addons')
      .set('Authorization', `Bearer ${token}`)
      .send({ addon_type: 'static_ip', price: 100 });
    expect(res.status).toBe(422);
  });

  test('POST /api/plans/addons with invalid addon_type returns 422', async () => {
    const res = await request(app)
      .post('/api/plans/addons')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Static IP', addon_type: 'invalid', price: 100 });
    expect(res.status).toBe(422);
  });
});
