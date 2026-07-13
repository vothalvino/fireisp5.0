// =============================================================================
// FireISP 5.0 — Bulk Validation Tests
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/eventBus', () => ({
  emit: jest.fn(),
  on: jest.fn(),
  removeListener: jest.fn(),
}));
jest.mock('../src/services/suspensionService');
// checkBulkEmailDailyBudget reads/writes cacheService directly (not
// express-rate-limit) — mock it so the daily-recipient-budget tests are
// deterministic instead of depending on the real in-memory LRU cache's state.
jest.mock('../src/services/cacheService', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  flush: jest.fn(),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const suspensionService = require('../src/services/suspensionService');
const eventBus = require('../src/services/eventBus');
const cacheService = require('../src/services/cacheService');
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
// POST /api/bulk/invoices/generate
// =============================================================================
describe('POST /api/bulk/invoices/generate', () => {
  test('rejects empty body → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects non-array contract_ids → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('valid contract_ids → 200', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);

    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [1, 2, 3] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(3);
  });

  test('rejects >500 contracts → 400', async () => {
    mockAuthUser();
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const res = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: ids });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/500/);
  });
});

// =============================================================================
// POST /api/bulk/suspend
// =============================================================================
describe('POST /api/bulk/suspend', () => {
  test('rejects empty body → 400', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('valid body → 200', async () => {
    mockAuthUser();
    // SELECT id, status FROM contracts — each contract exists and is active
    db.query.mockResolvedValue([[{ id: 10, status: 'active', organization_id: 1 }]]);
    suspensionService.suspendContract.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [10, 20], reason: 'Non-payment' });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(2);
    expect(suspensionService.suspendContract).toHaveBeenCalledTimes(2);
  });

  // Bug fix (fold-in requested by coordinator, 2026-07-12): bulk suspend
  // previously ran a raw UPDATE that bypassed suspensionService entirely —
  // no CoA disconnect, no radius.status flip, no suspension-exemption check.
  test('routes each contract through suspensionService.suspendContract (CoA + radius + exemption checks apply)', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[{ id: 10, status: 'active', organization_id: 1 }]]);
    suspensionService.suspendContract.mockResolvedValue(undefined);

    await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [10], reason: 'Non-payment' });

    expect(suspensionService.suspendContract).toHaveBeenCalledWith(10, null, 1, null);
  });

  test('reports a suspension-exempt client as failed, not success', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[{ id: 10, status: 'active', organization_id: 1 }]]);
    suspensionService.suspendContract.mockResolvedValue({ skipped: true, reason: 'VIP' });

    const res = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [10] });

    expect(res.status).toBe(200);
    expect(res.body.data.success).toBe(0);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors[0].error).toMatch(/exempt/i);
  });

  test('reports an already-suspended contract as failed without calling suspensionService', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[{ id: 10, status: 'suspended', organization_id: 1 }]]);

    const res = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [10] });

    expect(res.status).toBe(200);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors[0].error).toBe("Cannot suspend a 'suspended' contract");
    expect(suspensionService.suspendContract).not.toHaveBeenCalled();
  });

  test('reports a not-found contract with a distinct message and does not call suspensionService', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[]]);

    const res = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [999] });

    expect(res.status).toBe(200);
    expect(res.body.data.failed).toBe(1);
    expect(res.body.data.errors[0].error).toBe('Not found');
    expect(suspensionService.suspendContract).not.toHaveBeenCalled();
  });

  // LOW finding (confirmed 2/2): the pre-filter only skipped status ===
  // 'suspended' — pending/cancelled/terminated/expired rows fell through to
  // suspendContract and failed with the FSM trigger's raw 'Invalid contract
  // status transition' error instead of a clear per-row message.
  test.each(['pending', 'cancelled', 'terminated', 'expired'])(
    "reports a '%s' contract as a clear per-row error without calling suspensionService",
    async (status) => {
      mockAuthUser();
      db.query.mockResolvedValue([[{ id: 10, status, organization_id: 1 }]]);

      const res = await request(app)
        .post('/api/bulk/suspend')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ contract_ids: [10] });

      expect(res.status).toBe(200);
      expect(res.body.data.failed).toBe(1);
      expect(res.body.data.errors[0].error).toBe(`Cannot suspend a '${status}' contract`);
      expect(suspensionService.suspendContract).not.toHaveBeenCalled();
    },
  );
});

// =============================================================================
// POST /api/bulk/email
// =============================================================================
describe('POST /api/bulk/email', () => {
  test('missing subject → 422', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], body: 'Hello' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('missing body → 422', async () => {
    mockAuthUser();
    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], subject: 'Hi' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('valid data → 200', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([[
      { id: 1, email: 'client@example.com', name: 'John Doe' },
    ]]);

    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], subject: 'Notice', body: 'Service update' });

    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(1);
  });

  test('subject too long (>500 chars) → 422', async () => {
    mockAuthUser();
    const longSubject = 'x'.repeat(501);
    const res = await request(app)
      .post('/api/bulk/email')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ client_ids: [1], subject: longSubject, body: 'Hello' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // Per-organization rolling-24h recipient budget (checkBulkEmailDailyBudget)
  // — a second, independent rate-limit layer on top of bulkEmailLimiter's
  // per-IP request-count budget, since one request can already fan out to up
  // to 1000 recipients.
  describe('daily recipient budget', () => {
    test('returns 429 when the daily recipient budget is exceeded, and emits zero events', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[
        { id: 1, email: 'client@example.com', name: 'John Doe' },
      ]]);
      // Already at the default 5000/day cap — tenantApiLimiter's own
      // cacheService.get calls (for its unrelated 'rl_tenant:*' key) return
      // this same mocked shape too, but its comparison logic tolerates the
      // mismatched fields without blocking the request itself.
      cacheService.get.mockResolvedValue({ count: 5000, resetAt: Date.now() + 60 * 60 * 1000 });

      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: [1], subject: 'Notice', body: 'Service update' });

      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(eventBus.emit).not.toHaveBeenCalledWith('bulk.email.queued', expect.anything());
    });

    test('succeeds and emits one event per resolved client when under both budgets', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[
        { id: 1, email: 'a@example.com', name: 'A' },
        { id: 2, email: 'b@example.com', name: 'B' },
      ]]);
      cacheService.get.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: [1, 2], subject: 'Notice', body: 'Service update' });

      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(2);
      expect(eventBus.emit).toHaveBeenCalledTimes(2);
      expect(eventBus.emit).toHaveBeenCalledWith('bulk.email.queued', expect.objectContaining({ clientId: 1 }));
      expect(eventBus.emit).toHaveBeenCalledWith('bulk.email.queued', expect.objectContaining({ clientId: 2 }));
      // The budget check is keyed by org, and its increment must be persisted.
      expect(cacheService.set).toHaveBeenCalledWith(
        'bulk_email_daily:1',
        expect.objectContaining({ count: 2 }),
        expect.any(Number),
      );
    });

    test('does not consult the daily budget when zero clients resolve (all not_found)', async () => {
      mockAuthUser();
      db.query.mockResolvedValue([[]]); // no matching clients in this org

      const res = await request(app)
        .post('/api/bulk/email')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ client_ids: [999], subject: 'Notice', body: 'Service update' });

      expect(res.status).toBe(200);
      expect(res.body.data.queued).toBe(0);
      // tenantApiLimiter's own CacheStore also calls cacheService.get (for
      // its unrelated 'rl_tenant:*' key) — assert the daily-budget-specific
      // key was never consulted, rather than "cacheService.get was never
      // called at all".
      expect(cacheService.get).not.toHaveBeenCalledWith('bulk_email_daily:1');
    });
  });
});

// =============================================================================
// Regression smoke: other /bulk/* routes are unaffected by bulkEmailLimiter
// =============================================================================
describe('bulkEmailLimiter does not leak onto other /bulk routes', () => {
  test('POST /bulk/invoices/generate and /bulk/suspend still work (not gated by bulkEmailLimiter)', async () => {
    mockAuthUser();
    db.query.mockResolvedValue([{ affectedRows: 1 }]);

    const genRes = await request(app)
      .post('/api/bulk/invoices/generate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [1] });
    expect(genRes.status).toBe(200);

    db.query.mockResolvedValue([[{ id: 10, status: 'active', organization_id: 1 }]]);
    suspensionService.suspendContract.mockResolvedValue(undefined);
    const suspendRes = await request(app)
      .post('/api/bulk/suspend')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ contract_ids: [10] });
    expect(suspendRes.status).toBe(200);
  });
});
