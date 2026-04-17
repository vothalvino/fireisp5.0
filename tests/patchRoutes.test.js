// =============================================================================
// FireISP 5.0 — PATCH Partial-Update Route Integration Tests
// =============================================================================
// Tests PATCH /:id endpoints for all 10 top-used resources:
//   clients, contracts, invoices, devices, payments,
//   tickets, plans, users, organizations, sites
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/auditLog', () => ({ log: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const auditLog = require('../src/services/auditLog');
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
  auditLog.log.mockResolvedValue();
});

// =============================================================================
// Helper: run standard PATCH tests for a CRUD resource
// =============================================================================
function describePatch(name, path, mockRecord, patchBody, updatedRecord) {
  describe(`PATCH ${path}/:id`, () => {

    test('partially updates the record and returns 200', async () => {
      mockAuthUser();
      db.query
        .mockResolvedValueOnce([[mockRecord]])       // findByIdOrFail (old)
        .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
        .mockResolvedValueOnce([[updatedRecord]]);     // findById (updated)

      const res = await request(app)
        .patch(`${path}/1`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(patchBody);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    test('returns 404 when record not found', async () => {
      mockAuthUser();
      db.query.mockResolvedValueOnce([[]]);

      const res = await request(app)
        .patch(`${path}/999`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(patchBody);

      expect(res.status).toBe(404);
    });

    test('returns 401 without auth header', async () => {
      const res = await request(app)
        .patch(`${path}/1`)
        .send(patchBody);

      expect(res.status).toBe(401);
    });

    test('returns 422 with invalid data', async () => {
      mockAuthUser();

      const res = await request(app)
        .patch(`${path}/1`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ status: 12345 });

      expect(res.status).toBe(422);
    });
  });
}

// =============================================================================
// 1. CLIENTS
// =============================================================================
describePatch(
  'Client',
  '/api/clients',
  { id: 1, organization_id: 1, name: 'Acme Corp', email: 'acme@test.com', status: 'active' },
  { name: 'Acme Updated' },
  { id: 1, organization_id: 1, name: 'Acme Updated', email: 'acme@test.com', status: 'active' },
);

// =============================================================================
// 2. CONTRACTS
// =============================================================================
describePatch(
  'Contract',
  '/api/contracts',
  { id: 1, organization_id: 1, client_id: 10, plan_id: 5, status: 'active' },
  { status: 'suspended' },
  { id: 1, organization_id: 1, client_id: 10, plan_id: 5, status: 'suspended' },
);

// =============================================================================
// 3. INVOICES
// =============================================================================
describePatch(
  'Invoice',
  '/api/invoices',
  { id: 1, organization_id: 1, client_id: 10, subtotal: 100, total: 116, status: 'draft' },
  { status: 'issued' },
  { id: 1, organization_id: 1, client_id: 10, subtotal: 100, total: 116, status: 'issued' },
);

// =============================================================================
// 4. DEVICES
// =============================================================================
describePatch(
  'Device',
  '/api/devices',
  { id: 1, organization_id: 1, name: 'Router-1', type: 'router', status: 'active' },
  { name: 'Router-1-Updated' },
  { id: 1, organization_id: 1, name: 'Router-1-Updated', type: 'router', status: 'active' },
);

// =============================================================================
// 5. PAYMENTS
// =============================================================================
describePatch(
  'Payment',
  '/api/payments',
  { id: 1, organization_id: 1, client_id: 10, amount: 500, status: 'pending' },
  { status: 'completed' },
  { id: 1, organization_id: 1, client_id: 10, amount: 500, status: 'completed' },
);

// =============================================================================
// 6. TICKETS
// =============================================================================
describePatch(
  'Ticket',
  '/api/tickets',
  { id: 1, organization_id: 1, subject: 'No internet', priority: 'high', status: 'open' },
  { priority: 'critical' },
  { id: 1, organization_id: 1, subject: 'No internet', priority: 'critical', status: 'open' },
);

// =============================================================================
// 7. PLANS
// =============================================================================
describePatch(
  'Plan',
  '/api/plans',
  { id: 1, organization_id: 1, name: '50Mbps', price: 499, status: 'active' },
  { price: 599 },
  { id: 1, organization_id: 1, name: '50Mbps', price: 599, status: 'active' },
);

// =============================================================================
// 8. USERS (User model is fully mocked — need special handling)
// =============================================================================
describe('PATCH /api/users/:id', () => {
  const mockUserRecord = { id: 2, organization_id: 1, first_name: 'John', last_name: 'Doe', email: 'john@test.com', status: 'active' };

  beforeEach(() => {
    User.hasOrgScope = true;
    User.tableName = 'users';
    User.fillable = [
      'organization_id', 'first_name', 'last_name', 'email',
      'password_hash', 'role', 'phone', 'status',
    ];
    User.sortable = ['id', 'created_at', 'updated_at', 'first_name', 'last_name', 'email', 'role', 'status'];
  });

  test('partially updates the record and returns 200', async () => {
    mockAuthUser();
    User.findByIdOrFail.mockResolvedValue(mockUserRecord);
    User.update.mockResolvedValue({ ...mockUserRecord, first_name: 'Jane' });

    const res = await request(app)
      .patch('/api/users/2')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ first_name: 'Jane' });

    expect(res.status).toBe(200);
    expect(res.body.data.first_name).toBe('Jane');
  });

  test('returns 404 when record not found', async () => {
    mockAuthUser();
    const { NotFoundError } = require('../src/utils/errors');
    User.findByIdOrFail.mockRejectedValue(new NotFoundError('users'));

    const res = await request(app)
      .patch('/api/users/999')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ first_name: 'Jane' });

    expect(res.status).toBe(404);
  });

  test('returns 401 without auth header', async () => {
    const res = await request(app)
      .patch('/api/users/2')
      .send({ first_name: 'Jane' });

    expect(res.status).toBe(401);
  });

  test('returns 422 with invalid data', async () => {
    mockAuthUser();

    const res = await request(app)
      .patch('/api/users/2')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 12345 });

    expect(res.status).toBe(422);
  });
});

// =============================================================================
// 9. ORGANIZATIONS
// =============================================================================
describePatch(
  'Organization',
  '/api/organizations',
  { id: 1, name: 'Test ISP', status: 'active' },
  { name: 'Updated ISP' },
  { id: 1, name: 'Updated ISP', status: 'active' },
);

// =============================================================================
// 10. SITES
// =============================================================================
describePatch(
  'Site',
  '/api/sites',
  { id: 1, organization_id: 1, name: 'Main POP', site_type: 'pop', status: 'active' },
  { name: 'Primary POP' },
  { id: 1, organization_id: 1, name: 'Primary POP', site_type: 'pop', status: 'active' },
);
