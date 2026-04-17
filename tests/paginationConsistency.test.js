// =============================================================================
// FireISP 5.0 — Pagination Consistency Tests
// =============================================================================
// Verifies that all list endpoints support ?page=&limit= query params and
// return a consistent { data, meta } response shape.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/alertService');
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
const alertService = require('../src/services/alertService');
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
// Helper to validate meta shape
// =============================================================================
function expectPaginationMeta(meta, { total, page, limit }) {
  expect(meta).toBeDefined();
  expect(meta.total).toBe(total);
  expect(meta.page).toBe(page);
  expect(meta.limit).toBe(limit);
  expect(meta.totalPages).toBe(Math.ceil(total / limit));
}

// =============================================================================
// ALERTS — /api/alerts/rules
// =============================================================================
describe('Pagination — GET /api/alerts/rules', () => {
  test('returns page 1 with default limit', async () => {
    mockAuthUser();
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: i + 1, name: `Rule ${i + 1}` }));
    db.query
      .mockResolvedValueOnce([rows])
      .mockResolvedValueOnce([[{ total: 3 }]]);

    const res = await request(app)
      .get('/api/alerts/rules')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expectPaginationMeta(res.body.meta, { total: 3, page: 1, limit: 50 });
  });

  test('respects custom page and limit', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ id: 3, name: 'Rule 3' }]])
      .mockResolvedValueOnce([[{ total: 5 }]]);

    const res = await request(app)
      .get('/api/alerts/rules?page=2&limit=2')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expectPaginationMeta(res.body.meta, { total: 5, page: 2, limit: 2 });
  });

  test('clamps limit to 100', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await request(app)
      .get('/api/alerts/rules?limit=200')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.limit).toBe(100);
  });
});

// =============================================================================
// ALERTS — /api/alerts/events
// =============================================================================
describe('Pagination — GET /api/alerts/events', () => {
  test('returns paginated alert events', async () => {
    mockAuthUser();
    alertService.getAlertHistory.mockResolvedValue({
      data: [{ id: 1 }],
      meta: { total: 10, page: 1, limit: 50, totalPages: 1 },
    });

    const res = await request(app)
      .get('/api/alerts/events')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.total).toBe(10);
  });

  test('passes page and limit to service', async () => {
    mockAuthUser();
    alertService.getAlertHistory.mockResolvedValue({
      data: [],
      meta: { total: 0, page: 3, limit: 10, totalPages: 0 },
    });

    await request(app)
      .get('/api/alerts/events?page=3&limit=10')
      .set('Authorization', `Bearer ${authToken}`);

    expect(alertService.getAlertHistory).toHaveBeenCalledWith(1, { page: 3, limit: 10 });
  });
});

// =============================================================================
// ROLES — /api/roles
// =============================================================================
describe('Pagination — GET /api/roles', () => {
  test('returns paginated roles', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ id: 1, name: 'admin' }, { id: 2, name: 'support' }]])
      .mockResolvedValueOnce([[{ total: 2 }]]);

    const res = await request(app)
      .get('/api/roles')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expectPaginationMeta(res.body.meta, { total: 2, page: 1, limit: 50 });
  });

  test('supports page 2', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 5 }]]);

    const res = await request(app)
      .get('/api/roles?page=2&limit=5')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expectPaginationMeta(res.body.meta, { total: 5, page: 2, limit: 5 });
  });
});

// =============================================================================
// FACTURAS PÚBLICAS — /api/facturas-publicas
// =============================================================================
describe('Pagination — GET /api/facturas-publicas', () => {
  test('returns paginated facturas', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ id: 1, total: '100.00' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const res = await request(app)
      .get('/api/facturas-publicas')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expectPaginationMeta(res.body.meta, { total: 1, page: 1, limit: 50 });
  });

  test('respects custom page and limit', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 20 }]]);

    const res = await request(app)
      .get('/api/facturas-publicas?page=3&limit=5')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expectPaginationMeta(res.body.meta, { total: 20, page: 3, limit: 5 });
  });
});

// =============================================================================
// FACTURAS PÚBLICAS ITEMS — /api/facturas-publicas/:id/items
// =============================================================================
describe('Pagination — GET /api/facturas-publicas/:id/items', () => {
  test('returns paginated items', async () => {
    mockAuthUser();
    db.query
      .mockResolvedValueOnce([[{ id: 1, invoice_id: 5 }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const res = await request(app)
      .get('/api/facturas-publicas/1/items')
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expectPaginationMeta(res.body.meta, { total: 1, page: 1, limit: 50 });
  });
});
