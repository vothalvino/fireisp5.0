// =============================================================================
// FireISP 5.0 — RMA Request Route Tests (§14)
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const app = require('../src/app');

function adminToken() {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 10 },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const sampleRma = {
  id: 1,
  organization_id: 10,
  rma_number: 'RMA-2026-001',
  asset_id: 1,
  vendor_id: 1,
  status: 'open',
  reason: 'defective',
  description: 'Device fails to boot',
  shipped_at: null,
  received_at: null,
  resolved_at: null,
  replacement_asset_id: null,
  created_by: 1,
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
};

function mockDbDefault() {
  db.query.mockImplementation((sql) => {
    // Auth: user lookup — SELECT from users (WHERE id = ?, not rma/asset tables)
    if (typeof sql === 'string' && sql.includes('WHERE id = ?') &&
        !sql.includes('rma_requests') && !sql.includes('assets')) {
      return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
    }
    // RBAC permissions check
    if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
      return Promise.resolve([[{ id: 1, name: 'rma.view' }]]);
    }
    // Audit log INSERT
    if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
      return Promise.resolve([{ insertId: 99 }]);
    }
    // assets queries (used by ship/close transitions)
    if (typeof sql === 'string' && sql.includes('assets')) {
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      return Promise.resolve([[{ id: 1, lifecycle_status: 'rma', organization_id: 10 }]]);
    }
    // rma_requests queries
    if (typeof sql === 'string' && sql.includes('rma_requests')) {
      if (sql.includes('INSERT INTO')) return Promise.resolve([{ insertId: 1 }]);
      if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('DELETE')) return Promise.resolve([{ affectedRows: 1 }]);
      if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: 1 }]]);
      return Promise.resolve([[sampleRma]]);
    }
    return Promise.resolve([[]]);
  });
}

describe('GET /api/v1/rma-requests', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with RMA list', async () => {
    const res = await request(app)
      .get('/api/v1/rma-requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
  });
});

describe('POST /api/v1/rma-requests', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('creates an RMA request and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/rma-requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ rma_number: 'RMA-2026-001', asset_id: 1, reason: 'defective', description: 'Device fails to boot' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
  });

  it('returns 422 when rma_number is missing', async () => {
    const res = await request(app)
      .post('/api/v1/rma-requests')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ asset_id: 1, reason: 'defective' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/rma-requests/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 200 with a single RMA', async () => {
    const res = await request(app)
      .get('/api/v1/rma-requests/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('rma_number', 'RMA-2026-001');
  });
});

describe('POST /api/v1/rma-requests/:id/ship', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('ships an RMA and returns 200', async () => {
    const res = await request(app)
      .post('/api/v1/rma-requests/1/ship')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/rma-requests/:id/receive', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('returns 400 when status is not shipped', async () => {
    // sampleRma status is 'open', not 'shipped' — should return 400
    const res = await request(app)
      .post('/api/v1/rma-requests/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(400);
  });

  it('receives an RMA when status is shipped', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') &&
          !sql.includes('rma_requests') && !sql.includes('assets')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'rma.update' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('assets')) {
        if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
        return Promise.resolve([[{ id: 1, lifecycle_status: 'rma', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('rma_requests')) {
        if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
        if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: 1 }]]);
        // Return RMA with status 'shipped' so receive transition is allowed
        return Promise.resolve([[{ ...sampleRma, status: 'shipped' }]]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/rma-requests/1/receive')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/rma-requests/:id/close', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('closes an RMA and returns 200', async () => {
    db.query.mockImplementation((sql) => {
      if (typeof sql === 'string' && sql.includes('WHERE id = ?') &&
          !sql.includes('rma_requests') && !sql.includes('assets')) {
        return Promise.resolve([[{ id: 1, email: 'admin@test.com', role: 'admin', status: 'active', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && (sql.includes('permissions') || sql.includes('role_permissions'))) {
        return Promise.resolve([[{ id: 1, name: 'rma.close' }]]);
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO audit_logs')) {
        return Promise.resolve([{ insertId: 99 }]);
      }
      if (typeof sql === 'string' && sql.includes('assets')) {
        if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
        return Promise.resolve([[{ id: 1, lifecycle_status: 'rma', organization_id: 10 }]]);
      }
      if (typeof sql === 'string' && sql.includes('rma_requests')) {
        if (sql.includes('UPDATE')) return Promise.resolve([{ affectedRows: 1 }]);
        if (sql.includes('COUNT(*)')) return Promise.resolve([[{ total: 1 }]]);
        // Return RMA with status 'received' so close is allowed
        return Promise.resolve([[{ ...sampleRma, status: 'received' }]]);
      }
      return Promise.resolve([[]]);
    });
    const res = await request(app)
      .post('/api/v1/rma-requests/1/close')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ status: 'closed' });
    expect(res.status).toBe(200);
  });

  it('returns 422 when status param is missing', async () => {
    const res = await request(app)
      .post('/api/v1/rma-requests/1/close')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('PUT /api/v1/rma-requests/:id', () => {
  beforeEach(() => { mockDbDefault(); });
  afterEach(() => { jest.clearAllMocks(); });

  it('updates an RMA and returns 200', async () => {
    const res = await request(app)
      .put('/api/v1/rma-requests/1')
      .set('Authorization', `Bearer ${adminToken()}`)
      .set('X-Org-Id', '10')
      .send({ notes: 'Escalated to vendor' });
    expect(res.status).toBe(200);
  });
});
