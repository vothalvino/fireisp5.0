jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = {
      id: 4,
      organizationId: 17,
      apiTokenId: req.get('x-test-api-token') ? 99 : null,
    };
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => {
    req.orgId = 17;
    next();
  },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
}));

const express = require('express');
const request = require('supertest');
const db = require('../src/config/database');
const securityAdminRouter = require('../src/routes/securityAdmin');

const app = express();
app.use(express.json());
app.use('/security-admin', securityAdminRouter);
app.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).json({ error: { code: err.code, message: err.message } });
});

describe('security admin API-token rate-limit policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.withPrimaryContext.mockImplementation(callback => callback());
  });

  it('rejects a cross-organization token ID before the upsert', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM api_tokens')) return [[]];
      throw new Error(`unexpected query: ${sql}`);
    });

    const response = await request(app)
      .put('/security-admin/api-key-rate-limits/9001')
      .send({ requests_per_minute: 1 });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(db.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO api_key_rate_limits'), expect.anything());
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('id = ? AND organization_id = ?'),
      ['9001', 17],
    );
  });

  it('rejects rate-policy writes authenticated by an API token', async () => {
    const response = await request(app)
      .put('/security-admin/api-key-rate-limits/9')
      .set('x-test-api-token', '1')
      .send({ requests_per_minute: 999999 });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
    expect(db.withPrimaryContext).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('validates ownership and upserts policy inside primary control context', async () => {
    let primaryContext = false;
    db.withPrimaryContext.mockImplementation(async (callback) => {
      primaryContext = true;
      try { return await callback(); } finally { primaryContext = false; }
    });
    db.query.mockImplementation(async (sql) => {
      expect(primaryContext).toBe(true);
      if (sql.includes('FROM api_tokens')) return [[{ id: 9 }]];
      if (sql.includes('INSERT INTO api_key_rate_limits')) return [{ affectedRows: 1 }];
      throw new Error(`unexpected query: ${sql}`);
    });

    const response = await request(app)
      .put('/security-admin/api-key-rate-limits/9')
      .send({
        requests_per_minute: 1,
        requests_per_hour: 20,
        requests_per_day: 200,
        burst_size: 2,
        is_active: false,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(db.withPrimaryContext).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO api_key_rate_limits'),
      [17, '9', 1, 20, 200, 2, 0, 1],
    );
  });

  it('rejects zero and non-integer limits before querying the control plane', async () => {
    const zero = await request(app)
      .put('/security-admin/api-key-rate-limits/9')
      .send({ requests_per_minute: 0 });
    const fractional = await request(app)
      .put('/security-admin/api-key-rate-limits/9')
      .send({ burst_size: 1.5 });

    expect(zero.status).toBe(422);
    expect(fractional.status).toBe(422);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.withPrimaryContext).not.toHaveBeenCalled();
  });

  it('lists policies from the primary control plane for isolated organizations', async () => {
    let primaryContext = false;
    db.withPrimaryContext.mockImplementation(async (callback) => {
      primaryContext = true;
      try { return await callback(); } finally { primaryContext = false; }
    });
    db.query.mockImplementation(async (sql, params) => {
      expect(primaryContext).toBe(true);
      expect(sql).toContain('FROM api_key_rate_limits');
      expect(params).toEqual([17]);
      return [[{ id: 2, organization_id: 17, api_token_id: 9, is_active: 0 }]];
    });

    const response = await request(app).get('/security-admin/api-key-rate-limits');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].is_active).toBe(0);
    expect(db.withPrimaryContext).toHaveBeenCalledTimes(1);
  });
});
