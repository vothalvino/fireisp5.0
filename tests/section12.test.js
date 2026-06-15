// =============================================================================
// FireISP 5.0 — Section 12 Tests (Ticketing & NOC)
// =============================================================================

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/database');

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  queryReplica: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../src/services/pubsub', () => ({
  pubsub: { publish: jest.fn() },
}));

jest.mock('../src/services/jobQueueService', () => ({
  add: jest.fn().mockResolvedValue({}),
}));

jest.mock('../src/services/aiReplyService', () => ({
  generate: jest.fn().mockResolvedValue({ skipped: false, draftText: 'AI summary text', logId: 1 }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

// ---- NOC Dashboard ----
describe('GET /api/v1/noc/health', () => {
  it('returns device and alert stats', async () => {
    db.query
      .mockResolvedValueOnce([[{ devices_total: 10, devices_up: 8, devices_down: 1, devices_maintenance: 1 }]])
      .mockResolvedValueOnce([[{ severity: 'critical', count: 2 }, { severity: 'medium', count: 5 }]]);
    const res = await request(app).get('/api/v1/noc/health').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    // Response is now FLAT (matches what the frontend reads), not nested under `devices`.
    expect(res.body.data.devices_total).toBe(10);
    expect(res.body.data.devices_up).toBe(8);
    expect(res.body.data.devices_down).toBe(1);
    expect(res.body.data.devices_maintenance).toBe(1);
    // uptime_pct = round(up/total * 1000)/10 = round(8/10 * 1000)/10 = 80
    expect(res.body.data.uptime_pct).toBe(80);
    expect(res.body.data.active_alerts).toEqual([
      { severity: 'critical', count: 2 },
      { severity: 'medium', count: 5 },
    ]);
  });
});

describe('GET /api/v1/noc/ticket-queue', () => {
  it('returns open tickets', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, subject: 'Test ticket', priority: 'high', status: 'open', created_at: new Date() },
    ]]);
    const res = await request(app).get('/api/v1/noc/ticket-queue').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('GET /api/v1/noc/sla-compliance', () => {
  it('returns compliance percentage', async () => {
    db.query.mockResolvedValueOnce([[{ total: 100, compliant: 90 }]]);
    const res = await request(app).get('/api/v1/noc/sla-compliance').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.compliance_pct).toBe(90);
  });
});

// ---- Ticket time logs ----
describe('POST /api/v1/tickets/:id/time-logs', () => {
  it('creates a time log entry', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 5 }])
      .mockResolvedValueOnce([[{ id: 5, ticket_id: 1, user_id: 1, minutes: 60, work_date: '2026-06-12' }]]);
    const res = await request(app)
      .post('/api/v1/tickets/1/time-logs')
      .set('X-Org-Id', '1')
      .send({ minutes: 60, work_date: '2026-06-12' });
    expect(res.status).toBe(201);
    expect(res.body.data.minutes).toBe(60);
  });

  it('returns 422 when minutes missing', async () => {
    const res = await request(app)
      .post('/api/v1/tickets/1/time-logs')
      .set('X-Org-Id', '1')
      .send({ work_date: '2026-06-12' });
    expect(res.status).toBe(422);
  });
});

// ---- Ticket AI triage ----
describe('GET /api/v1/tickets/:id/ai-triage', () => {
  it('returns triage result', async () => {
    db.query.mockResolvedValueOnce([[{ id: 1, ticket_id: 99, suggested_category: 'connectivity' }]]);
    const res = await request(app).get('/api/v1/tickets/99/ai-triage').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data.suggested_category).toBe('connectivity');
  });

  it('returns 404 when no triage result', async () => {
    db.query.mockResolvedValueOnce([[undefined]]);
    const res = await request(app).get('/api/v1/tickets/99/ai-triage').set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

// ---- Work Orders ----
describe('POST /api/v1/work-orders', () => {
  it('creates a work order', async () => {
    db.query
      .mockResolvedValueOnce([{ insertId: 10 }])
      .mockResolvedValueOnce([[{ id: 10, organization_id: 1, title: 'Fix antenna', status: 'pending', priority: 'high' }]]);
    const res = await request(app)
      .post('/api/v1/work-orders')
      .set('X-Org-Id', '1')
      .send({ title: 'Fix antenna', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Fix antenna');
  });
});

describe('GET /api/v1/work-orders/stats', () => {
  it('returns counts by status', async () => {
    db.query.mockResolvedValueOnce([[
      { status: 'pending', count: 3 },
      { status: 'completed', count: 10 },
    ]]);
    const res = await request(app).get('/api/v1/work-orders/stats').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });
});

// ---- Technician Tracking ----
describe('POST /api/v1/technician-tracking/breadcrumb', () => {
  it('ingests a GPS breadcrumb', async () => {
    db.query.mockResolvedValueOnce([{ insertId: 1 }]);
    const res = await request(app)
      .post('/api/v1/technician-tracking/breadcrumb')
      .set('X-Org-Id', '1')
      .send({ latitude: 19.432608, longitude: -99.133209 });
    expect(res.status).toBe(201);
    expect(res.body.data.ok).toBe(true);
  });

  it('returns 422 when coords missing', async () => {
    const res = await request(app)
      .post('/api/v1/technician-tracking/breadcrumb')
      .set('X-Org-Id', '1')
      .send({});
    expect(res.status).toBe(422);
  });
});

describe('GET /api/v1/technician-tracking/positions', () => {
  it('returns last known positions', async () => {
    db.query.mockResolvedValueOnce([[
      { user_id: 5, latitude: 19.4, longitude: -99.1, first_name: 'Carlos', last_name: 'Torres' },
    ]]);
    const res = await request(app).get('/api/v1/technician-tracking/positions').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data[0].first_name).toBe('Carlos');
  });
});

describe('POST /api/v1/technician-tracking/route-optimize', () => {
  it('returns ordered route using nearest neighbor', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, title: 'Job A', latitude: 19.43, longitude: -99.13, scheduled_at: null },
      { id: 2, title: 'Job B', latitude: 19.44, longitude: -99.14, scheduled_at: null },
    ]]);
    const res = await request(app)
      .post('/api/v1/technician-tracking/route-optimize')
      .set('X-Org-Id', '1')
      .send({ technician_id: 5, start_lat: 19.42, start_lng: -99.12 });
    expect(res.status).toBe(200);
    expect(res.body.data.route).toHaveLength(2);
    expect(res.body.data.total_distance_km).toBeGreaterThan(0);
  });

  it('returns empty route when no orders', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const res = await request(app)
      .post('/api/v1/technician-tracking/route-optimize')
      .set('X-Org-Id', '1')
      .send({ technician_id: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.route).toHaveLength(0);
  });
});
