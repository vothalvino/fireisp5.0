'use strict';

const request = require('supertest');
jest.mock('../src/config/database');
const db = require('../src/config/database');

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organization_id: 1, role: 'admin' };
    next();
  },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = 1;
    next();
  },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

const app = require('../src/app');

describe('GET /api/v1/data-packs', () => {
  it('returns data packs list', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, name: 'Basic 10GB', data_gb: '10.000' }]]);
    const res = await request(app)
      .get('/api/v1/data-packs')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/v1/data-packs', () => {
  it('creates a data pack', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 1, name: 'New Pack', data_gb: '5.000' }]]);
    const res = await request(app)
      .post('/api/v1/data-packs')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test')
      .send({ name: 'New Pack', data_gb: 5, price: 50 });
    expect(res.status).toBe(201);
  });

  it('rejects missing required fields', async () => {
    const res = await request(app)
      .post('/api/v1/data-packs')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test')
      .send({ name: 'Missing price pack' }); // missing data_gb and price
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/fup/notifications', () => {
  it('returns FUP notification list', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, contract_id: 5, threshold_pct: 80, billing_month: '2026-06-01' },
    ]]);
    const res = await request(app)
      .get('/api/v1/fup/notifications')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/rollover/accrue (POST)', () => {
  it('triggers rollover accrual', async () => {
    db.query.mockResolvedValueOnce([[]]); // no contracts to accrue
    const res = await request(app)
      .post('/api/v1/rollover/accrue')
      .set('X-Org-Id', '1')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(200);
  });
});
