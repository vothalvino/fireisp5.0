// =============================================================================
// PPPoE event ingest + readiness route tests
// =============================================================================

const express = require('express');
const request = require('supertest');

jest.mock('../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, role: 'admin', organizationId: 77 };
    next();
  },
}));
jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = req.user.organizationId; next(); },
}));
jest.mock('../src/middleware/rbac', () => ({
  requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../src/services/pppoeDiagnosticsService', () => ({
  parseRouterOsLogLine: jest.fn(),
  classifyAuthFailures: jest.fn(),
  detectMtuIssues: jest.fn(),
}));
jest.mock('../src/services/pppoeReadinessService', () => ({ getReadiness: jest.fn() }));
jest.mock('../src/services/pppoeEventCollector', () => ({ deriveEventIdentity: jest.fn() }));
jest.mock('../src/models/PppoeEventLog', () => ({ create: jest.fn() }));

const db = require('../src/config/database');
const diagnostics = require('../src/services/pppoeDiagnosticsService');
const readiness = require('../src/services/pppoeReadinessService');
const collector = require('../src/services/pppoeEventCollector');
const PppoeEventLog = require('../src/models/PppoeEventLog');
const pppoeRouter = require('../src/routes/pppoe');

const app = express();
app.use(express.json());
app.use('/pppoe', pppoeRouter);
app.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).json({
    error: { code: err.code || 'INTERNAL_ERROR', message: err.message, details: err.details },
  });
});

describe('PPPoE routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PPPOE_EVENTS_SECRET = 'test-pppoe-secret';
    db.query.mockResolvedValue([[{ id: 5, organization_id: 44 }]]);
    diagnostics.parseRouterOsLogLine.mockReturnValue({
      stage: 'AUTH', severity: 'error', reason_code: 'auth_failed',
    });
    collector.deriveEventIdentity.mockReturnValue({ username: 'alice', mac: 'AA:BB:CC:DD:EE:FF' });
    PppoeEventLog.create.mockImplementation(async (data) => ({ id: 1, ...data }));
  });

  afterAll(() => { delete process.env.PPPOE_EVENTS_SECRET; });

  test('raw ingest parses the line, derives tenant from NAS, and omits a missing timestamp', async () => {
    const res = await request(app)
      .post('/pppoe/events')
      .set('X-Pppoe-Secret', 'test-pppoe-secret')
      .send({ nas_id: 5, line: 'alice: login incorrect from AA:BB:CC:DD:EE:FF' });

    expect(res.status).toBe(201);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM nas'), [5]);
    expect(db.query.mock.calls[0][0]).toContain("status = 'active'");
    expect(db.query.mock.calls[0][0]).toContain("odc.isolation_mode = 'isolated'");
    expect(PppoeEventLog.create).toHaveBeenCalledWith({
      organization_id: 44,
      nas_id: 5,
      username: 'alice',
      mac: 'AA:BB:CC:DD:EE:FF',
      stage: 'AUTH',
      severity: 'error',
      message: 'alice: login incorrect from AA:BB:CC:DD:EE:FF',
      reason_code: 'auth_failed',
    });
    expect(PppoeEventLog.create.mock.calls[0][0]).not.toHaveProperty('logged_at');
  });

  test('structured ingest accepts a valid timestamp/MAC and still derives tenant from NAS', async () => {
    const res = await request(app)
      .post('/pppoe/events')
      .set('Authorization', 'Bearer test-pppoe-secret')
      .send({
        nas_id: 5,
        message: 'custom event',
        stage: 'LCP',
        severity: 'warning',
        reason_code: 'peer_timeout',
        username: 'bob',
        mac: 'aa-bb-cc-dd-ee-ff',
        logged_at: '2026-08-14T12:34:56Z',
      });

    expect(res.status).toBe(201);
    expect(PppoeEventLog.create.mock.calls[0][0]).toMatchObject({
      organization_id: 44, nas_id: 5, username: 'bob', mac: 'AA:BB:CC:DD:EE:FF',
      stage: 'LCP', severity: 'warning', reason_code: 'peer_timeout',
      logged_at: expect.any(Date),
    });
  });

  test.each([
    [{ nas_id: 5, message: 'x', stage: 'BOGUS' }, 'stage'],
    [{ nas_id: 5, message: 'x', severity: 'fatal' }, 'severity'],
    [{ nas_id: 5, message: 'x', mac: 'not-a-mac' }, 'mac'],
    [{ nas_id: 5, message: 'x', logged_at: '2026-02-31T29:00:00Z' }, 'logged_at'],
    [{ nas_id: 5, message: 'x', organization_id: 999 }, 'organization_id'],
  ])('rejects invalid or non-contract payload field with 422 (%s)', async (payload, field) => {
    const res = await request(app)
      .post('/pppoe/events')
      .set('X-Pppoe-Secret', 'test-pppoe-secret')
      .send(payload);

    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ field }),
    ]));
    expect(PppoeEventLog.create).not.toHaveBeenCalled();
  });

  test('rejects an unknown NAS and an invalid shared secret', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const unknown = await request(app)
      .post('/pppoe/events')
      .set('X-Pppoe-Secret', 'test-pppoe-secret')
      .send({ nas_id: 999, message: 'event' });
    expect(unknown.status).toBe(422);

    const unauthorized = await request(app)
      .post('/pppoe/events')
      .set('X-Pppoe-Secret', 'wrong')
      .send({ nas_id: 5, message: 'event' });
    expect(unauthorized.status).toBe(401);
  });

  test('authenticated readiness route returns the exact service envelope for the request tenant', async () => {
    const data = {
      overall: 'partial',
      sources: {
        authentication: {
          status: 'ready', lastReceivedAt: null, events24h: 1, detail: 'ok',
          detailCode: 'authentication_recent_external', detailParams: {},
        },
        routerEvents: {
          status: 'waiting', lastReceivedAt: null, events24h: 0, detail: 'wait',
          detailCode: 'router_waiting_no_events',
          detailParams: { coveredNas: 1, totalNas: 1 },
          coveredNas: 1, totalNas: 1, maintenanceNas: 0,
        },
        accounting: {
          status: 'waiting', lastReceivedAt: null, events24h: 0, detail: 'wait',
          detailCode: 'accounting_waiting', detailParams: {},
        },
      },
    };
    readiness.getReadiness.mockResolvedValueOnce(data);

    const res = await request(app).get('/pppoe/diagnostics/readiness');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data });
    expect(readiness.getReadiness).toHaveBeenCalledWith(77);
  });
});
