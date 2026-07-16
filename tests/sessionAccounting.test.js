// =============================================================================
// FireISP 5.0 — Session Accounting Endpoint Tests
// Tests for GET /connection-logs/daily-usage and GET /connection-logs/top-consumers
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, role: 'admin', organization_id: 1 };
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
}));

const request = require('supertest');
const express = require('express');
const connectionLogsRouter = require('../src/routes/connectionLogs');
const db = require('../src/config/database');

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use('/connection-logs', connectionLogsRouter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAILY_ROWS = [
  {
    usage_date: '2026-03-15',
    client_id: 10,
    contract_id: 1,
    username: 'client10',
    session_count: 3,
    bytes_in: 1073741824,   // 1 GB
    bytes_out: 536870912,   // 0.5 GB
    bytes_total: 1610612736,
    duration_seconds: 1800,
  },
  {
    usage_date: '2026-03-14',
    client_id: 20,
    contract_id: 2,
    username: 'client20',
    session_count: 5,
    bytes_in: 2147483648,   // 2 GB
    bytes_out: 1073741824,  // 1 GB
    bytes_total: 3221225472,
    duration_seconds: 3600,
  },
];

const COUNT_ROW = [{ total: 2 }];

const TOP_ROWS = [
  {
    client_id: 20,
    contract_id: 2,
    username: 'client20',
    active_days: 10,
    session_count: 30,
    bytes_in: 10737418240,  // 10 GB
    bytes_out: 5368709120,  // 5 GB
    bytes_total: 16106127360,
    duration_seconds: 36000,
  },
  {
    client_id: 10,
    contract_id: 1,
    username: 'client10',
    active_days: 8,
    session_count: 20,
    bytes_in: 5368709120,   // 5 GB
    bytes_out: 2684354560,  // 2.5 GB
    bytes_total: 8053063680,
    duration_seconds: 18000,
  },
];

// ---------------------------------------------------------------------------
// GET /connection-logs/daily-usage
// ---------------------------------------------------------------------------

describe('GET /connection-logs/daily-usage', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns paginated daily usage rows', async () => {
    db.query
      .mockResolvedValueOnce([DAILY_ROWS])      // data rows
      .mockResolvedValueOnce([COUNT_ROW]);       // count

    const res = await request(app)
      .get('/connection-logs/daily-usage')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.date_from).toBe('2026-03-01');
    expect(res.body.meta.date_to).toBe('2026-03-31');
  });

  test('first row has expected shape', async () => {
    db.query
      .mockResolvedValueOnce([DAILY_ROWS])
      .mockResolvedValueOnce([COUNT_ROW]);

    const res = await request(app)
      .get('/connection-logs/daily-usage')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });

    const row = res.body.data[0];
    expect(row.usage_date).toBe('2026-03-15');
    expect(row.client_id).toBe(10);
    expect(row.contract_id).toBe(1);
    expect(row.username).toBe('client10');
    expect(row.session_count).toBe(3);
    expect(row.bytes_in).toBe(1073741824);
    expect(row.bytes_total).toBe(1610612736);
  });

  test('passes client_id filter to the query', async () => {
    db.query
      .mockResolvedValueOnce([[DAILY_ROWS[0]]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const res = await request(app)
      .get('/connection-logs/daily-usage')
      .query({ client_id: '10', date_from: '2026-03-01', date_to: '2026-03-31' });

    expect(res.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('client_id = ?');
    expect(params).toContain('10');
  });

  test('passes contract_id filter to the query', async () => {
    db.query
      .mockResolvedValueOnce([[DAILY_ROWS[0]]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    await request(app)
      .get('/connection-logs/daily-usage')
      .query({ contract_id: '1', date_from: '2026-03-01', date_to: '2026-03-31' });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('contract_id = ?');
    expect(params).toContain('1');
  });

  test('uses default 30-day window when no dates supplied', async () => {
    db.query
      .mockResolvedValueOnce([DAILY_ROWS])
      .mockResolvedValueOnce([COUNT_ROW]);

    const res = await request(app).get('/connection-logs/daily-usage');

    expect(res.status).toBe(200);
    expect(res.body.meta.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.meta.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('honours page and limit parameters', async () => {
    db.query
      .mockResolvedValueOnce([[DAILY_ROWS[0]]])
      .mockResolvedValueOnce([[{ total: 10 }]]);

    const res = await request(app)
      .get('/connection-logs/daily-usage')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31', page: 2, limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(2);
    expect(res.body.meta.limit).toBe(1);

    // OFFSET should be 1 (page 2 × limit 1 − 1)
    const callParams = db.query.mock.calls[0][1];
    const offset = callParams[callParams.length - 1];
    expect(offset).toBe(1);
  });

  test('returns 200 with empty data when no rows exist', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]]);

    const res = await request(app)
      .get('/connection-logs/daily-usage')
      .query({ date_from: '2020-01-01', date_to: '2020-01-02' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.meta.total).toBe(0);
  });

  test('forwards db errors to express error handler', async () => {
    db.query.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .get('/connection-logs/daily-usage')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /connection-logs/top-consumers
// ---------------------------------------------------------------------------

describe('GET /connection-logs/top-consumers', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns top consumers sorted by bytes_total', async () => {
    db.query.mockResolvedValueOnce([TOP_ROWS]);

    const res = await request(app)
      .get('/connection-logs/top-consumers')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].client_id).toBe(20);
    expect(res.body.data[0].bytes_total).toBe(16106127360);
  });

  test('response includes meta with date range and limit', async () => {
    db.query.mockResolvedValueOnce([TOP_ROWS]);

    const res = await request(app)
      .get('/connection-logs/top-consumers')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31', limit: 5 });

    expect(res.body.meta.date_from).toBe('2026-03-01');
    expect(res.body.meta.date_to).toBe('2026-03-31');
    expect(res.body.meta.limit).toBe(5);
  });

  test('passes limit parameter to the SQL query', async () => {
    db.query.mockResolvedValueOnce([TOP_ROWS]);

    await request(app)
      .get('/connection-logs/top-consumers')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31', limit: 5 });

    const params = db.query.mock.calls[0][1];
    expect(params).toContain(5);
  });

  test('row has all required fields', async () => {
    db.query.mockResolvedValueOnce([TOP_ROWS]);

    const res = await request(app)
      .get('/connection-logs/top-consumers')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });

    const row = res.body.data[0];
    expect(row).toHaveProperty('client_id');
    expect(row).toHaveProperty('contract_id');
    expect(row).toHaveProperty('username');
    expect(row).toHaveProperty('active_days');
    expect(row).toHaveProperty('session_count');
    expect(row).toHaveProperty('bytes_in');
    expect(row).toHaveProperty('bytes_out');
    expect(row).toHaveProperty('bytes_total');
    expect(row).toHaveProperty('duration_seconds');
  });

  test('uses default 30-day window when no dates supplied', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app).get('/connection-logs/top-consumers');

    expect(res.status).toBe(200);
    expect(res.body.meta.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.meta.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('returns empty data when no sessions exist', async () => {
    db.query.mockResolvedValueOnce([[]]);

    const res = await request(app)
      .get('/connection-logs/top-consumers')
      .query({ date_from: '2020-01-01', date_to: '2020-01-02' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('forwards db errors to express error handler', async () => {
    db.query.mockRejectedValueOnce(new Error('DB down'));
    const res = await request(app)
      .get('/connection-logs/top-consumers')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });
    expect(res.status).toBe(500);
  });
});
