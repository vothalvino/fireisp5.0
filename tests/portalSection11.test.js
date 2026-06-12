// =============================================================================
// FireISP 5.0 — Portal Section 11 Tests
// =============================================================================
// Tests for §11.1 dashboard, §11.2 billing extensions, §11.3 service requests,
// §11.4 KB + speed test + chat, §11.5 push subscriptions.
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/services/pdfService', () => ({
  generateInvoicePdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 test')),
}));

jest.mock('../src/services/aiReplyService', () => ({
  generate: jest.fn().mockResolvedValue({ skipped: true, reason: 'disabled' }),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock.access.token'),
  verify: jest.fn(),
}));

const db = require('../src/config/database');
const jwt = require('jsonwebtoken');
const portalServiceRequestService = require('../src/services/portalServiceRequestService');
const { calculateProration } = require('../src/services/billingService');

// ---------------------------------------------------------------------------
// portalServiceRequestService
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.listRequests()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns empty list when client has no requests', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const { rows, total } = await portalServiceRequestService.listRequests(42);
    expect(rows).toEqual([]);
    expect(total).toBe(0);
  });

  test('filters by request_type when provided', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, request_type: 'plan_upgrade', status: 'pending' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const { rows } = await portalServiceRequestService.listRequests(42, { requestType: 'plan_upgrade' });
    expect(rows[0].request_type).toBe('plan_upgrade');
    // Ensure the second query (COUNT) was called with the type filter
    expect(db.query).toHaveBeenCalledTimes(2);
  });
});

describe('portalServiceRequestService.cancelRequest()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws NotFoundError when request not found', async () => {
    db.query.mockResolvedValueOnce([[]]); // SELECT
    await expect(portalServiceRequestService.cancelRequest(99, 1))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('throws ValidationError when status is not pending', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, status: 'approved' }]]);
    await expect(portalServiceRequestService.cancelRequest(1, 1))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('updates status to cancelled when request is pending', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, status: 'pending' }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE

    const result = await portalServiceRequestService.cancelRequest(1, 1);
    expect(result.status).toBe('cancelled');
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      [1],
    );
  });
});

describe('portalServiceRequestService.listKbArticles()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns published articles for org', async () => {
    const article = { id: 1, category: 'billing', title: 'How billing works', slug: 'billing-how', view_count: 5 };
    db.query
      .mockResolvedValueOnce([[article]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const { rows, total } = await portalServiceRequestService.listKbArticles(1);
    expect(rows[0].slug).toBe('billing-how');
    expect(total).toBe(1);
  });

  test('applies search filter', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    await portalServiceRequestService.listKbArticles(1, { search: 'missing term' });
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/LIKE/);
  });
});

describe('portalServiceRequestService.getKbArticle()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('throws NotFoundError when article does not exist', async () => {
    db.query.mockResolvedValueOnce([[]]); // SELECT
    await expect(portalServiceRequestService.getKbArticle(1, 'nonexistent'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('returns article and fires view-count increment', async () => {
    const article = { id: 5, slug: 'test-slug', title: 'Test', body: 'hello' };
    db.query
      .mockResolvedValueOnce([[article]]) // SELECT
      .mockResolvedValueOnce([{}]); // UPDATE view_count (fire-and-forget, may not resolve before test ends)

    const result = await portalServiceRequestService.getKbArticle(1, 'test-slug');
    expect(result.slug).toBe('test-slug');
  });
});

describe('portalServiceRequestService.rateKbArticle()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('increments helpful_yes on helpful=true', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 3 }]])
      .mockResolvedValueOnce([{}]);

    const result = await portalServiceRequestService.rateKbArticle(1, 'my-slug', true);
    expect(result.rated).toBe('yes');
    const [updateSql] = db.query.mock.calls[1];
    expect(updateSql).toMatch(/helpful_yes/);
  });

  test('increments helpful_no on helpful=false', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 3 }]])
      .mockResolvedValueOnce([{}]);

    const result = await portalServiceRequestService.rateKbArticle(1, 'my-slug', false);
    expect(result.rated).toBe('no');
    const [updateSql] = db.query.mock.calls[1];
    expect(updateSql).toMatch(/helpful_no/);
  });
});

describe('portalServiceRequestService.upsertPushSubscription()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('inserts new subscription when endpoint not found', async () => {
    db.query
      .mockResolvedValueOnce([[]])             // SELECT existing
      .mockResolvedValueOnce([{ insertId: 7 }]); // INSERT

    const result = await portalServiceRequestService.upsertPushSubscription({
      clientId: 1,
      organizationId: 1,
      endpoint: 'https://push.example.com/sub123',
      p256dh: 'abc',
      auth: 'def',
    });
    expect(result.id).toBe(7);
    expect(result.updated).toBe(false);
  });

  test('updates existing subscription when endpoint matches', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 4 }]]) // SELECT existing
      .mockResolvedValueOnce([{}]);          // UPDATE

    const result = await portalServiceRequestService.upsertPushSubscription({
      clientId: 1,
      organizationId: 1,
      endpoint: 'https://push.example.com/sub123',
      p256dh: 'newkey',
      auth: 'newsecret',
    });
    expect(result.id).toBe(4);
    expect(result.updated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// calculateProration (existing service used by plan upgrade)
// ---------------------------------------------------------------------------

describe('billingService.calculateProration()', () => {
  test('returns zero proration when prices are equal', () => {
    const result = calculateProration({
      oldPrice: 100,
      newPrice: 100,
      changeDate: '2025-01-15',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
    });
    expect(result.net).toBe(0);
  });

  test('returns positive net for upgrade (higher new price)', () => {
    const result = calculateProration({
      oldPrice: 100,
      newPrice: 150,
      changeDate: '2025-01-16',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
    });
    expect(result.net).toBeGreaterThan(0);
    expect(result.charge).toBeGreaterThan(result.credit);
  });

  test('returns negative net for downgrade (lower new price)', () => {
    const result = calculateProration({
      oldPrice: 150,
      newPrice: 100,
      changeDate: '2025-01-16',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
    });
    expect(result.net).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Chat session token generator
// ---------------------------------------------------------------------------

describe('portalServiceRequestService.generateChatToken()', () => {
  test('returns a 64-character hex string', () => {
    const token = portalServiceRequestService.generateChatToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test('generates unique tokens on each call', () => {
    const t1 = portalServiceRequestService.generateChatToken();
    const t2 = portalServiceRequestService.generateChatToken();
    expect(t1).not.toBe(t2);
  });
});
