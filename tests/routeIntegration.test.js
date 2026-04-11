// =============================================================================
// FireISP 5.0 — HTTP Endpoint Integration Tests
// =============================================================================
// Tests Express routes end-to-end with mocked database and models.
// =============================================================================

// Mock the database module before requiring anything else
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const testHash = bcrypt.hashSync('password123', 10);

function makeToken(payload = {}) {
  return jwt.sign(
    {
      sub: 1,
      email: 'test@example.com',
      role: 'admin',
      orgId: 1,
      ...payload,
    },
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

function mockConnection() {
  const conn = {
    execute: jest.fn().mockResolvedValue([{ insertId: 1, affectedRows: 1 }]),
    beginTransaction: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue(undefined),
    rollback: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
  };
  db.getConnection.mockResolvedValue(conn);
  return conn;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
});

// =============================================================================
// AUTH ROUTES — /api/auth
// =============================================================================
describe('Auth Routes — /api/auth', () => {

  describe('POST /api/auth/register', () => {
    test('success — creates a new user', async () => {
      User.findByEmail.mockResolvedValue(null);
      User.create.mockResolvedValue({
        id: 10,
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        role: 'support',
        status: 'active',
      });
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/auth/register')
        .send({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'jane@example.com',
          password: 'securepass1',
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.email).toBe('jane@example.com');
    });
  });

  describe('POST /api/auth/login', () => {
    test('success — returns token and user', async () => {
      User.findByEmail.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        password_hash: testHash,
        status: 'active',
        role: 'admin',
        organization_id: 1,
      });
      User.getOrganizations.mockResolvedValue([
        { id: 1, name: 'Org One', membership_role: 'admin' },
      ]);
      // update last_login + insert session
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.user.email).toBe('test@example.com');
      expect(res.body.data.organizations).toHaveLength(1);
    });
  });

  describe('POST /api/auth/logout', () => {
    test('success — logs out with valid token', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Logged out');
    });
  });

  describe('GET /api/auth/me', () => {
    test('success — returns current user + organizations', async () => {
      mockAuthUser();
      User.findById.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
        status: 'active',
        role: 'admin',
        organization_id: 1,
        password_hash: 'hashed',
      });
      User.getOrganizations.mockResolvedValue([
        { id: 1, name: 'Org One', membership_role: 'admin' },
      ]);

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('test@example.com');
      expect(res.body.data.organizations).toHaveLength(1);
      // password_hash must be stripped
      expect(res.body.data.password_hash).toBeUndefined();
    });
  });

  describe('POST /api/auth/password-reset/request', () => {
    test('success — returns message', async () => {
      User.findByEmail.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
      });
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/auth/password-reset/request')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.message).toBeDefined();
    });
  });

  describe('POST /api/auth/change-password', () => {
    test('success — changes password for authenticated user', async () => {
      mockAuthUser();
      // Second call inside authService.changePassword
      User.findById.mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        status: 'active',
        role: 'admin',
        organization_id: 1,
        password_hash: testHash,
      });
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ currentPassword: 'password123', newPassword: 'newSecure99' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/changed/i);
    });
  });
});

// =============================================================================
// CLIENT ROUTES — /api/clients
// =============================================================================
describe('Client Routes — /api/clients', () => {

  describe('GET /api/clients', () => {
    test('authenticated list returns data + meta', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ id: 1, name: 'Client A' }]])          // findAll
        .mockResolvedValueOnce([[{ total: 1 }]]);                         // count

      const res = await request(app)
        .get('/api/clients')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.meta).toBeDefined();
    });
  });

  describe('POST /api/clients', () => {
    test('create with valid body returns 201', async () => {
      mockAuthUser();
      // Model.create: first query = INSERT, second = findById
      db.query
        .mockResolvedValueOnce([{ insertId: 5, affectedRows: 1 }])
        .mockResolvedValueOnce([[{ id: 5, name: 'New Client', organization_id: 1, status: 'active' }]])
        // auditLog.log
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .post('/api/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'New Client' });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(5);
    });
  });

  describe('GET /api/clients/:id', () => {
    test('returns client by id', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[{ id: 3, name: 'Client C', organization_id: 1 }]]);

      const res = await request(app)
        .get('/api/clients/3')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(3);
    });
  });

  describe('PUT /api/clients/:id', () => {
    test('update returns updated record', async () => {
      mockAuthUser();
      db.query
        // findByIdOrFail (old)
        .mockResolvedValueOnce([[{ id: 3, name: 'Old Name', organization_id: 1 }]])
        // update query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // findById (return updated)
        .mockResolvedValueOnce([[{ id: 3, name: 'Updated', organization_id: 1 }]])
        // auditLog
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .put('/api/clients/3')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated');
    });
  });

  describe('DELETE /api/clients/:id', () => {
    test('delete returns 204', async () => {
      mockAuthUser();
      db.query
        // findByIdOrFail (old)
        .mockResolvedValueOnce([[{ id: 3, name: 'To Delete', organization_id: 1 }]])
        // delete query
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // auditLog
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      const res = await request(app)
        .delete('/api/clients/3')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(204);
    });
  });
});

// =============================================================================
// BILLING ROUTES — /api/billing
// =============================================================================
describe('Billing Routes — /api/billing', () => {

  describe('POST /api/billing/generate-period', () => {
    test('generates a billing period', async () => {
      mockAuthUser();
      db.query
        // fetch contract
        .mockResolvedValueOnce([[{ id: 1, plan_id: 1, client_id: 1, start_date: '2025-01-01', billing_day: 1 }]])
        // check existing pending period
        .mockResolvedValueOnce([[]])
        // find last invoiced period
        .mockResolvedValueOnce([[]])
        // insert billing_period
        .mockResolvedValueOnce([{ insertId: 100 }])
        // select new billing period
        .mockResolvedValueOnce([[{ id: 100, contract_id: 1, status: 'pending' }]]);

      const res = await request(app)
        .post('/api/billing/generate-period')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('POST /api/billing/generate-invoice', () => {
    test('generates invoice for a contract', async () => {
      mockAuthUser();
      const conn = mockConnection();

      db.query
        // fetch contract
        .mockResolvedValueOnce([[{ id: 1, plan_id: 2, client_id: 1, start_date: '2025-01-01', billing_day: 1 }]])
        // fetch plan
        .mockResolvedValueOnce([[{ id: 2, name: '50 Mbps', price: 499.00, currency: 'MXN' }]])
        // billingService.generateBillingPeriod: check existing pending
        .mockResolvedValueOnce([[]])
        // find last invoiced
        .mockResolvedValueOnce([[]])
        // insert billing_period
        .mockResolvedValueOnce([{ insertId: 101 }])
        // select new billing period
        .mockResolvedValueOnce([[{ id: 101, contract_id: 1, period_start: '2025-01-01', period_end: '2025-01-31', status: 'pending' }]]);

      // billingService.generateInvoice uses conn.execute many times
      conn.execute
        // tax_rates query
        .mockResolvedValueOnce([[]])
        // count invoices
        .mockResolvedValueOnce([[{ cnt: 5 }]])
        // insert invoice
        .mockResolvedValueOnce([{ insertId: 200 }])
        // insert line item (plan)
        .mockResolvedValueOnce([{ insertId: 300 }])
        // contract addons
        .mockResolvedValueOnce([[]])
        // update billing period
        .mockResolvedValueOnce([{ affectedRows: 1 }])
        // insert ledger debit
        .mockResolvedValueOnce([{ affectedRows: 1 }]);

      // Invoice.findById after conn.commit (uses db.query)
      db.query.mockResolvedValueOnce([[{ id: 200, invoice_number: 'INV-000006', total: 499.00, status: 'issued' }]]);

      const res = await request(app)
        .post('/api/billing/generate-invoice')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_id: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('POST /api/billing/bulk-generate', () => {
    test('bulk generate for active contracts', async () => {
      mockAuthUser();
      // fetch active contracts with plan info
      db.query.mockResolvedValueOnce([[
        { id: 1, plan_id: 1, client_id: 1, start_date: '2025-01-01', billing_day: 1, plan_name: '50 Mbps', plan_price: 499, plan_currency: 'MXN', status: 'active' },
      ]]);
      // billingService.generateBillingPeriod: check existing pending
      db.query.mockResolvedValueOnce([[{ id: 50, contract_id: 1, status: 'pending', period_start: '2025-01-01', period_end: '2025-01-31' }]]);

      const conn = mockConnection();
      conn.execute
        .mockResolvedValueOnce([[]])           // tax_rates
        .mockResolvedValueOnce([[{ cnt: 0 }]]) // count invoices
        .mockResolvedValueOnce([{ insertId: 1 }]) // insert invoice
        .mockResolvedValueOnce([{ insertId: 1 }]) // insert line item
        .mockResolvedValueOnce([[]])              // addons
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // update billing period
        .mockResolvedValueOnce([{ affectedRows: 1 }]); // ledger debit

      // Invoice.findById
      db.query.mockResolvedValueOnce([[{ id: 1, invoice_number: 'INV-000001', status: 'issued' }]]);

      const res = await request(app)
        .post('/api/billing/bulk-generate')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.total_contracts).toBeDefined();
    });
  });
});

// =============================================================================
// DASHBOARD ROUTES — /api/dashboard
// =============================================================================
describe('Dashboard Routes — /api/dashboard', () => {

  describe('GET /api/dashboard/summary', () => {
    test('returns aggregated KPIs', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[{ total: 100, active: 80 }]])     // clients
        .mockResolvedValueOnce([[{ total: 90, active: 70, suspended: 5 }]])  // contracts
        .mockResolvedValueOnce([[{ outstanding: 5000, collected: 20000, total_invoiced: 25000 }]]) // revenue
        .mockResolvedValueOnce([[{ total: 30, open_count: 10 }]])  // tickets
        .mockResolvedValueOnce([[{ total: 50, monitored: 40 }]]);  // devices

      const res = await request(app)
        .get('/api/dashboard/summary')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.clients).toBeDefined();
      expect(res.body.data.contracts).toBeDefined();
      expect(res.body.data.revenue_30d).toBeDefined();
    });
  });

  describe('GET /api/dashboard/revenue', () => {
    test('returns monthly revenue', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[
        { month: '2025-06', currency: 'MXN', invoiced: 50000, collected: 40000, invoice_count: 100 },
      ]]);

      const res = await request(app)
        .get('/api/dashboard/revenue')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].month).toBe('2025-06');
    });
  });

  describe('GET /api/dashboard/mrr', () => {
    test('returns MRR data', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[
        { currency: 'MXN', active_contracts: 70, mrr: 34930, arpu: 499 },
      ]]);

      const res = await request(app)
        .get('/api/dashboard/mrr')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].mrr).toBe(34930);
    });
  });
});

// =============================================================================
// EXPORT ROUTES — /api/export
// =============================================================================
describe('Export Routes — /api/export', () => {

  describe('GET /api/export/clients', () => {
    test('returns CSV content', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[
        { id: 1, first_name: 'John', last_name: 'Doe', email: 'john@test.com', phone: '555-1234', status: 'active', locale: 'global', country: 'US', city: 'Austin', state: 'TX', created_at: '2025-01-01' },
      ]]);

      const res = await request(app)
        .get('/api/export/clients')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('first_name');
      expect(res.text).toContain('John');
    });
  });

  describe('GET /api/export/invoices', () => {
    test('returns CSV content', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[
        { id: 1, invoice_number: 'INV-000001', client_id: 1, first_name: 'John', last_name: 'Doe', email: 'john@test.com', subtotal: 499, tax_amount: 79.84, total: 578.84, currency: 'MXN', status: 'issued', due_date: '2025-02-15', created_at: '2025-01-01' },
      ]]);

      const res = await request(app)
        .get('/api/export/invoices')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.text).toContain('invoice_number');
    });
  });
});

// =============================================================================
// IMPORT ROUTES — /api/import
// =============================================================================
describe('Import Routes — /api/import', () => {

  describe('POST /api/import/clients', () => {
    test('imports clients from CSV string', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([{ affectedRows: 1 }]);

      const csvData = 'first_name,last_name,email,phone\nAlice,Smith,alice@test.com,555-0001\nBob,Jones,bob@test.com,555-0002';

      const res = await request(app)
        .post('/api/import/clients')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ csv: csvData });

      expect(res.status).toBe(200);
      expect(res.body.data.imported).toBe(2);
      expect(res.body.data.total).toBe(2);
    });
  });
});

// =============================================================================
// VALIDATION TESTS
// =============================================================================
describe('Validation Tests', () => {

  test('POST /api/auth/register with missing fields returns 422', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'only@email.com' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toBeDefined();
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  test('POST /api/billing/generate-period with invalid contract_id returns 422', async () => {
    mockAuthUser();

    const res = await request(app)
      .post('/api/billing/generate-period')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_id: 'not-a-number' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('POST /api/import/clients without csv field returns 422', async () => {
    mockAuthUser();

    const res = await request(app)
      .post('/api/import/clients')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
