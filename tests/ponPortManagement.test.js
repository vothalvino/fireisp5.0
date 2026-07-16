// =============================================================================
// Tests: §7.3 PON Port Management (ftthService + oltManagement routes)
// =============================================================================
// All DB calls are mocked via jest.mock('../src/config/database').
// =============================================================================

'use strict';

const request = require('supertest');
const app = require('../src/app');

jest.mock('../src/config/database', () => ({
  query:         jest.fn(),
  queryReplica:  jest.fn(),
  execute:       jest.fn(),
  getConnection: jest.fn(),
  close:         jest.fn(),
  pool:          { end: jest.fn() },
}));

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 1, organization_id: 1, email: 'admin@test.com', role: 'admin' };
    req.userId = 1;
    next();
  },
}));

jest.mock('../src/middleware/orgScope', () => ({
  orgScope: (req, _res, next) => { req.orgId = 1; next(); },
}));

jest.mock('../src/middleware/rbac', () => ({
  userHasPermission: async () => true,
  requirePermission: () => (_req, _res, next) => next(),
  requireRole:       () => (_req, _res, next) => next(),
}));

jest.mock('../src/middleware/ipAllowlist', () => ({
  createIpAllowlist: () => (_req, _res, next) => next(),
  parseAllowlist:    () => [],
}));

const db = require('../src/config/database');
const { query: mockQuery } = db;

beforeEach(() => {
  jest.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Power budget calculator (pure calculation — no DB)
// ---------------------------------------------------------------------------

describe('POST /api/olt-management/power-budget', () => {
  it('returns budget result for a standard 1:32 splitter', async () => {
    const res = await request(app)
      .post('/api/olt-management/power-budget')
      .set('Authorization', 'Bearer test')
      .send({ olt_tx_power_dbm: 3.0, splitter_ratio: '1:32', fiber_length_m: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      splitter_loss_db: 17.0,
      result: expect.any(String),
    });
    // fiber loss = 5km * 0.35 = 1.75 dB
    expect(res.body.data.fiber_loss_db).toBeCloseTo(1.75, 2);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/olt-management/power-budget')
      .set('Authorization', 'Bearer test')
      .send({ splitter_ratio: '1:32' }); // missing olt_tx_power_dbm and fiber_length_m

    expect(res.status).toBe(400);
  });

  it('marks result as exceeded when total loss > 28 dB', async () => {
    // 20km fiber + 1:64 splitter should exceed budget
    const res = await request(app)
      .post('/api/olt-management/power-budget')
      .set('Authorization', 'Bearer test')
      .send({ olt_tx_power_dbm: 3.0, splitter_ratio: '1:64', fiber_length_m: 20000 });

    expect(res.status).toBe(200);
    expect(res.body.data.result).toBe('exceeded');
  });
});

// ---------------------------------------------------------------------------
// Port utilization dashboard
// ---------------------------------------------------------------------------

describe('GET /api/olt-management/ports/:portId/utilization', () => {
  it('returns port utilization with ONU counts and optical summary', async () => {
    db.query
      .mockResolvedValueOnce([[{
        id: 1, port_name: 'GPON 0/1/1', port_type: 'gpon',
        onu_count: 24, max_onus: 128, olt_name: 'OLT-CO1',
      }]])
      .mockResolvedValueOnce([[{ onu_state: 'online', cnt: 20 }, { onu_state: 'offline', cnt: 4 }]])
      .mockResolvedValueOnce([[{ avg_rx_dbm: -22.5, min_rx_dbm: -25.1, max_rx_dbm: -19.8, avg_tx_dbm: 2.1 }]]);

    const res = await request(app)
      .get('/api/olt-management/ports/1/utilization')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.data.port).toBeDefined();
    expect(res.body.data.onu_state_counts).toHaveLength(2);
    expect(res.body.data.optical_summary).toMatchObject({ avg_rx_dbm: -22.5 });
  });

  it('returns 404 for unknown port', async () => {
    db.query.mockResolvedValueOnce([[]]); // no port row
    const res = await request(app)
      .get('/api/olt-management/ports/9999/utilization')
      .set('Authorization', 'Bearer test');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// ONUs per port list
// ---------------------------------------------------------------------------

describe('GET /api/olt-management/ports/:portId/onus', () => {
  it('returns list of ONUs on the port', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 10, name: 'ONU-001', onu_state: 'online', onu_id: 1 },
      { id: 11, name: 'ONU-002', onu_state: 'offline', onu_id: 2 },
    ]]);

    const res = await request(app)
      .get('/api/olt-management/ports/1/onus')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it('filters by state query param', async () => {
    db.query.mockResolvedValueOnce([[{ id: 10, name: 'ONU-001', onu_state: 'online' }]]);

    const res = await request(app)
      .get('/api/olt-management/ports/1/onus?state=online')
      .set('Authorization', 'Bearer test');

    expect(res.status).toBe(200);
    // Verify SQL was called with state filter (mock query arg inspection)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('onu_state = ?'),
      expect.arrayContaining(['online']),
    );
  });
});

// ---------------------------------------------------------------------------
// Port shutdown (maintenance mode)
// ---------------------------------------------------------------------------

describe('POST /api/olt-management/ports/:portId/shutdown', () => {
  it('enables maintenance mode', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1 }]]) // check exists
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE
      .mockResolvedValueOnce([[{ id: 1, maintenance_mode: 1, maintenance_note: 'fiber replacement' }]]);

    const res = await request(app)
      .post('/api/olt-management/ports/1/shutdown')
      .set('Authorization', 'Bearer test')
      .send({ enable: true, note: 'fiber replacement' });

    expect(res.status).toBe(200);
    expect(res.body.data.maintenance_mode).toBe(1);
  });

  it('clears maintenance mode', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 1, maintenance_mode: 0 }]]);

    const res = await request(app)
      .post('/api/olt-management/ports/1/shutdown')
      .set('Authorization', 'Bearer test')
      .send({ enable: false });

    expect(res.status).toBe(200);
    expect(res.body.data.maintenance_mode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// XGS-PON mode configuration
// ---------------------------------------------------------------------------

describe('POST /api/olt-management/ports/:portId/xgspon-mode', () => {
  it('sets xgspon_10g mode on a valid port', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, port_type: 'xgspon', manufacturer: 'Huawei', model: 'MA5800-X7' }]])
      .mockResolvedValueOnce([[{ protocols: JSON.stringify(['snmp', 'netconf', 'ssh_cli']) }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: 1, xgspon_mode: 'xgspon_10g', xgspon_mode_validated: 1 }]]);

    const res = await request(app)
      .post('/api/olt-management/ports/1/xgspon-mode')
      .set('Authorization', 'Bearer test')
      .send({ mode: 'xgspon_10g' });

    expect(res.status).toBe(200);
    expect(res.body.data.xgspon_mode).toBe('xgspon_10g');
  });

  it('returns 400 for missing mode', async () => {
    const res = await request(app)
      .post('/api/olt-management/ports/1/xgspon-mode')
      .set('Authorization', 'Bearer test')
      .send({});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// ONU migration jobs
// ---------------------------------------------------------------------------

describe('ONU Migration Jobs', () => {
  describe('GET /api/olt-management/onu-migrations', () => {
    it('returns paginated migration jobs', async () => {
      db.query
        .mockResolvedValueOnce([[{ total: 2 }]])
        .mockResolvedValueOnce([[
          { id: 1, status: 'pending', onu_name: 'ONU-001' },
          { id: 2, status: 'completed', onu_name: 'ONU-002' },
        ]]);

      const res = await request(app)
        .get('/api/olt-management/onu-migrations')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta.total).toBe(2);
    });
  });

  describe('POST /api/olt-management/onu-migrations', () => {
    it('creates a migration job', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 5, olt_port_id: 1 }]]) // ONU detail check
        .mockResolvedValueOnce([{ insertId: 99 }]) // INSERT
        .mockResolvedValueOnce([[{ id: 99, status: 'pending', onu_device_id: 5, source_olt_port_id: 1, target_olt_port_id: 2 }]]);

      const res = await request(app)
        .post('/api/olt-management/onu-migrations')
        .set('Authorization', 'Bearer test')
        .send({ onu_device_id: 5, source_olt_port_id: 1, target_olt_port_id: 2 });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe(99);
      expect(res.body.data.status).toBe('pending');
    });

    it('returns 400 when source == target port', async () => {
      db.query.mockResolvedValueOnce([[{ id: 5, olt_port_id: 1 }]]);

      const res = await request(app)
        .post('/api/olt-management/onu-migrations')
        .set('Authorization', 'Bearer test')
        .send({ onu_device_id: 5, source_olt_port_id: 3, target_olt_port_id: 3 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/olt-management/onu-migrations/:jobId/cancel', () => {
    it('cancels a pending job', async () => {
      db.query
        .mockResolvedValueOnce([[{ id: 1, status: 'pending' }]])   // check
        .mockResolvedValueOnce([{ affectedRows: 1 }])               // UPDATE
        .mockResolvedValueOnce([[{ id: 1, status: 'cancelled' }]]); // SELECT result

      const res = await request(app)
        .post('/api/olt-management/onu-migrations/1/cancel')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('cancelled');
    });

    it('returns 409 for a completed job', async () => {
      db.query.mockResolvedValueOnce([[{ id: 1, status: 'completed' }]]);

      const res = await request(app)
        .post('/api/olt-management/onu-migrations/1/cancel')
        .set('Authorization', 'Bearer test');

      expect(res.status).toBe(409);
    });
  });
});
