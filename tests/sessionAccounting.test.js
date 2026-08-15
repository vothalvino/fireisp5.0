// =============================================================================
// FireISP 5.0 — Session Accounting Endpoint Tests
// Tests for GET /connection-logs/daily-usage and GET /connection-logs/top-consumers
// =============================================================================

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  withPrimaryContext: jest.fn(callback => callback()),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, role: 'admin', organization_id: 1, apiTokenId: 77 };
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
    incomplete_rows: 0,
    unverifiable_session_rows: 0,
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
    incomplete_rows: 0,
    unverifiable_session_rows: 0,
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
    incomplete_rows: 0,
    unverifiable_session_rows: 0,
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
    incomplete_rows: 0,
    unverifiable_session_rows: 0,
  },
];

// ---------------------------------------------------------------------------
// GET /connection-logs
// ---------------------------------------------------------------------------

describe('GET /connection-logs', () => {
  beforeEach(() => jest.clearAllMocks());

  test('audits a tenant-scoped session view with stable API-token provenance', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 11,
        session_instance_id: 'f9aeb3d5-d6f1-4b9a-9c4d-f2ef40812ee2',
        username: 'subscriber-1',
      }]])
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([{ insertId: 90 }]);

    const res = await request(app)
      .get('/connection-logs')
      .query({ username: 'subscriber-1' })
      .set('User-Agent', 'session-audit-test');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.meta.total).toBe(1);
    expect(db.withPrimaryContext).toHaveBeenCalledTimes(1);
    const auditCall = db.query.mock.calls.find(([sql]) => /INSERT INTO report_access_logs/.test(sql));
    expect(auditCall).toBeDefined();
    expect(auditCall[0]).toContain('api_token_id');
    expect(auditCall[1].slice(0, 6)).toEqual([
      1, 1, 77, null, 'subscriber_session_view', 'connection_logs',
    ]);
    expect(auditCall[1][6]).toContain('subscriber-1');
  });

  test('strictly applies every session-list filter and marks stale non-stopped rows unknown', async () => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([{ insertId: 91 }]);

    const res = await request(app).get('/connection-logs').query({
      contract_id: '5',
      client_id: '10',
      username: 'alice',
      ip_address: '192.0.2.10',
      state: 'active',
      session_id: 'session-1',
      mac: 'AA:BB:CC:DD:EE:FF',
      nas: 'edge-1',
      date_from: '2026-08-01T00:00:00Z',
      date_to: '2026-08-14T23:59:59Z',
    });

    expect(res.status).toBe(200);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('cl.contract_id = ?');
    expect(sql).toContain('cl.client_id = ?');
    expect(sql).toContain('cl.username = ?');
    expect(sql).toContain('COALESCE(cl.framed_ip, cl.ip_address) = ?');
    expect(sql).toContain("cl.event_type = 'start'");
    expect(sql).toContain('COALESCE(cl.acct_session_id, cl.session_id) = ?');
    expect(sql).toContain('calling_station_id');
    expect(sql).toContain('filter_nas.organization_id = cl.organization_id');
    expect(sql).toContain('cl.event_at >= ?');
    expect(sql).toContain('cl.event_at <= ?');
    expect(sql).toContain('cl.last_accounting_received_at');
    expect(sql).toContain("THEN 'unknown'");
    expect(params).toEqual([
      1, 5, 10, 'alice', '192.0.2.10', 'session-1', '%aabbccddeeff%',
      '%edge-1%', 'edge-1', '2026-08-01T00:00:00Z', '2026-08-14T23:59:59Z',
    ]);
  });

  test.each([
    ['active', "cl.event_type = 'start'", true],
    ['interim', "cl.event_type = 'interim-update'", true],
    ['ended', "cl.event_type = 'stop'", false],
  ])('maps state=%s to its projection state and liveness rule', async (state, eventClause, needsLiveness) => {
    db.query
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 0 }]])
      .mockResolvedValueOnce([{ insertId: 92 }]);

    const res = await request(app).get('/connection-logs').query({ state });
    expect(res.status).toBe(200);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain(eventClause);
    const where = sql.slice(sql.indexOf('WHERE'));
    expect(where.includes('DATE_SUB(NOW(), INTERVAL')).toBe(needsLiveness);
  });

  test('formula-hardens leading control characters in session CSV exports', async () => {
    db.query
      .mockResolvedValueOnce([[{ total: 1 }]])
      .mockResolvedValueOnce([[
        { id: 9, organization_id: 1, record_kind: 'session', username: '\t=cmd' },
      ]])
      .mockResolvedValueOnce([{ insertId: 93 }]);

    const res = await request(app).get('/connection-logs/export').query({
      date_from: '2026-08-01T00:00:00Z',
      date_to: '2026-08-14T23:59:59Z',
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain("'\t=cmd");
  });
});

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
    expect(row.usage_complete).toBe(true);
  });

  test('marks a daily row incomplete when an unverified lifecycle overlaps', async () => {
    db.query
      .mockResolvedValueOnce([[{ ...DAILY_ROWS[0], unverifiable_session_rows: 1 }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    const res = await request(app)
      .get('/connection-logs/daily-usage')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].usage_complete).toBe(false);
    expect(res.body.data[0].unverifiable_session_rows).toBe(1);
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
    expect(params).toContain(10);
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
    expect(params).toContain(1);
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
    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('LIMIT 1 OFFSET 1');
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

    const sql = db.query.mock.calls[0][0];
    expect(sql).toContain('LIMIT 5');
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
    expect(row).toHaveProperty('usage_complete', true);
  });

  test('marks a top-consumer row incomplete when legacy accounting overlaps', async () => {
    db.query.mockResolvedValueOnce([[{ ...TOP_ROWS[0], unverifiable_session_rows: 1 }]]);

    const res = await request(app)
      .get('/connection-logs/top-consumers')
      .query({ date_from: '2026-03-01', date_to: '2026-03-31' });

    expect(res.status).toBe(200);
    expect(res.body.data[0].usage_complete).toBe(false);
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
