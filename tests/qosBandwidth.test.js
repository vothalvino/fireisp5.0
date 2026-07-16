// =============================================================================
// FireISP 5.0 — QoS Bandwidth & Rate Limiting API Tests (§10.1 + §10.2)
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

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashedpassword'),
  compare: jest.fn().mockResolvedValue(true),
}));

const db = require('../src/config/database');

beforeEach(() => {
  jest.resetAllMocks();
});

// ===========================================================================
// Quality Classes (§10.1)
// ===========================================================================

describe('GET /api/quality-classes', () => {
  it('returns list of quality classes with 200', async () => {
    const rows = [
      { id: 1, organization_id: null, name: 'VoIP', traffic_type: 'voip', priority: 1, dscp_mark: 'EF', status: 'active' },
      { id: 2, organization_id: null, name: 'Video Streaming', traffic_type: 'video', priority: 2, dscp_mark: 'AF41', status: 'active' },
    ];
    // list() calls Promise.all([findAll, count]) — 2 db.query calls
    db.query
      .mockResolvedValueOnce([rows])              // findAll
      .mockResolvedValueOnce([[{ total: 2 }]]);   // count
    const res = await request(app).get('/api/quality-classes').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('VoIP');
  });
});

describe('POST /api/quality-classes', () => {
  it('creates a quality class and returns 201', async () => {
    const newClass = { id: 5, organization_id: 1, name: 'Gaming', traffic_type: 'web', priority: 3, dscp_mark: 'AF31', status: 'active' };
    db.query
      .mockResolvedValueOnce([{ insertId: 5 }])
      .mockResolvedValueOnce([[newClass]]);
    const res = await request(app)
      .post('/api/quality-classes')
      .set('X-Org-Id', '1')
      .send({ name: 'Gaming', traffic_type: 'web', priority: 3, dscp_mark: 'AF31' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Gaming');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/quality-classes')
      .set('X-Org-Id', '1')
      .send({ traffic_type: 'voip' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/quality-classes/:id', () => {
  it('returns 404 for non-existent class', async () => {
    db.query.mockResolvedValueOnce([[]]);
    const res = await request(app).get('/api/quality-classes/999').set('X-Org-Id', '1');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/quality-classes/:id', () => {
  it('soft-deletes and returns 204', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, name: 'VoIP', organization_id: 1, deleted_at: null }]]) // findByIdOrFail
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // soft delete UPDATE
      .mockResolvedValueOnce([{ insertId: 99 }]);   // auditLog.log INSERT
    const res = await request(app).delete('/api/quality-classes/1').set('X-Org-Id', '1');
    expect(res.status).toBe(204);
  });
});

// ===========================================================================
// Queue Tree Nodes (§10.1)
// ===========================================================================

describe('GET /api/queue-tree-nodes', () => {
  it('returns list of queue tree nodes with 200', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, name: 'Global', queue_type: 'tree', max_limit_mbps: 1000, priority: 1, status: 'active' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
    const res = await request(app).get('/api/queue-tree-nodes').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/queue-tree-nodes', () => {
  it('creates a queue tree node and returns 201', async () => {
    const newNode = { id: 3, organization_id: 1, name: 'ISP-Main', queue_type: 'tree', max_limit_mbps: 500, status: 'active' };
    db.query
      .mockResolvedValueOnce([{ insertId: 3 }])
      .mockResolvedValueOnce([[newNode]]);
    const res = await request(app)
      .post('/api/queue-tree-nodes')
      .set('X-Org-Id', '1')
      .send({ name: 'ISP-Main', queue_type: 'tree', max_limit_mbps: 500 });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('ISP-Main');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/queue-tree-nodes')
      .set('X-Org-Id', '1')
      .send({ queue_type: 'tree' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/queue-tree-nodes/export/config', () => {
  it('returns JSON export with script and node_count', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, name: 'Global', queue_type: 'tree', max_limit_mbps: 1000, burst_limit_mbps: null, burst_threshold_mbps: null, burst_time_seconds: null, priority: 1, queue_kind: 'pcq', parent_name: null },
    ]]);
    const res = await request(app)
      .get('/api/queue-tree-nodes/export/config')
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('script');
    expect(res.body.data).toHaveProperty('node_count', 1);
    expect(res.body.data.script).toContain('FireISP');
  });
});

// ===========================================================================
// Rate Limit Templates (§10.2)
// ===========================================================================

describe('GET /api/rate-limit-templates', () => {
  it('returns list with 200', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, name: 'Basic 10M', service_type: 'pppoe', radius_vendor: 'mikrotik', download_mbps: 10, upload_mbps: 5, rate_string: '10M/5M 20M/10M 10M/5M 8', status: 'active' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
    const res = await request(app).get('/api/rate-limit-templates').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Basic 10M');
  });
});

describe('POST /api/rate-limit-templates', () => {
  it('creates a template with auto-rendered rate_string', async () => {
    const tmpl = { id: 2, organization_id: 1, name: 'PPPoE 20M', service_type: 'pppoe', radius_vendor: 'mikrotik', download_mbps: 20, upload_mbps: 10, rate_string: '20M/10M 40M/20M 20M/10M 8', status: 'active' };
    db.query
      .mockResolvedValueOnce([{ insertId: 2 }])
      .mockResolvedValueOnce([[tmpl]]);
    const res = await request(app)
      .post('/api/rate-limit-templates')
      .set('X-Org-Id', '1')
      .send({ name: 'PPPoE 20M', service_type: 'pppoe', radius_vendor: 'mikrotik', download_mbps: 20, upload_mbps: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.rate_string).toContain('20M/10M');
  });

  it('returns 422 when download_mbps or upload_mbps is missing', async () => {
    const res = await request(app)
      .post('/api/rate-limit-templates')
      .set('X-Org-Id', '1')
      .send({ name: 'Missing speeds', service_type: 'pppoe' });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/rate-limit-templates/preview', () => {
  it('returns rendered rate string for mikrotik', async () => {
    const res = await request(app)
      .post('/api/rate-limit-templates/preview')
      .set('X-Org-Id', '1')
      .send({ radius_vendor: 'mikrotik', download_mbps: 50, upload_mbps: 25, burst_download_mbps: 100, burst_upload_mbps: 50, burst_threshold_mbps: 40, burst_time_seconds: 12 });
    expect(res.status).toBe(200);
    expect(res.body.data.rate_string).toBe('50M/25M 100M/50M 40M/40M 12');
  });

  it('returns rendered rate string with default burst values', async () => {
    const res = await request(app)
      .post('/api/rate-limit-templates/preview')
      .set('X-Org-Id', '1')
      .send({ radius_vendor: 'mikrotik', download_mbps: 10, upload_mbps: 5 });
    expect(res.status).toBe(200);
    // Default: burst = 2x CIR, threshold = CIR, time = 8s
    expect(res.body.data.rate_string).toBe('10M/5M 20M/10M 10M/5M 8');
  });
});

// ===========================================================================
// Protocol Shaping Rules (§10.2)
// ===========================================================================

describe('GET /api/protocol-shaping-rules', () => {
  it('returns list with 200', async () => {
    db.query
      .mockResolvedValueOnce([[{ id: 1, name: 'BitTorrent Throttle', protocol: 'tcp', dst_port_range: '6881-6889', action: 'throttle', enabled: 0, preset: 'bittorrent_throttle' }]])
      .mockResolvedValueOnce([[{ total: 1 }]]);
    const res = await request(app).get('/api/protocol-shaping-rules').set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data[0].preset).toBe('bittorrent_throttle');
  });
});

describe('POST /api/protocol-shaping-rules', () => {
  it('creates a shaping rule and returns 201', async () => {
    const rule = { id: 5, organization_id: 1, name: 'Custom Throttle', protocol: 'tcp', action: 'throttle', enabled: 1 };
    db.query
      .mockResolvedValueOnce([{ insertId: 5 }])
      .mockResolvedValueOnce([[rule]]);
    const res = await request(app)
      .post('/api/protocol-shaping-rules')
      .set('X-Org-Id', '1')
      .send({ name: 'Custom Throttle', protocol: 'tcp', action: 'throttle', enabled: true });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Custom Throttle');
  });

  it('returns 422 when name is missing', async () => {
    const res = await request(app)
      .post('/api/protocol-shaping-rules')
      .set('X-Org-Id', '1')
      .send({ protocol: 'tcp', action: 'throttle' });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/protocol-shaping-rules/export/config', () => {
  it('returns JSON export with script and rule_count', async () => {
    db.query.mockResolvedValueOnce([[
      { id: 1, name: 'VoIP Priority', protocol: 'udp', direction: 'both', dst_port_range: '16384-32767', action: 'mark', dscp_mark: 'EF', priority: 1, enabled: 1, limit_download_mbps: null, limit_upload_mbps: null },
    ]]);
    const res = await request(app)
      .get('/api/protocol-shaping-rules/export/config')
      .set('X-Org-Id', '1');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('script');
    expect(res.body.data).toHaveProperty('rule_count', 1);
    expect(res.body.data.script).toContain('FireISP');
  });
});

// ===========================================================================
// radiusAttributeService — MikroTik burst with threshold/time
// ===========================================================================

describe('radiusAttributeService.generateAttributes() — MikroTik full burst', () => {
  const { generateAttributes } = require('../src/services/radiusAttributeService');

  it('generates basic 4-field MikroTik rate-limit string (defaults)', () => {
    const attrs = generateAttributes({
      download_speed_mbps: 20, upload_speed_mbps: 10,
      burst_download_mbps: null, burst_upload_mbps: null,
      burst_threshold_mbps: null, burst_time_seconds: null,
      radius_vendor: 'mikrotik',
    });
    // burst defaults: 2x CIR; threshold defaults: CIR; time defaults: 8
    expect(attrs['Mikrotik-Rate-Limit']).toBe('20M/10M 40M/20M 20M/10M 8');
  });

  it('uses explicit burst_threshold_mbps and burst_time_seconds', () => {
    const attrs = generateAttributes({
      download_speed_mbps: 100, upload_speed_mbps: 50,
      burst_download_mbps: 200, burst_upload_mbps: 100,
      burst_threshold_mbps: 80, burst_time_seconds: 16,
      radius_vendor: 'mikrotik',
    });
    expect(attrs['Mikrotik-Rate-Limit']).toBe('100M/50M 200M/100M 80M/80M 16');
  });

  it('falls back to CIR threshold when burst_threshold_mbps is null', () => {
    const attrs = generateAttributes({
      download_speed_mbps: 50, upload_speed_mbps: 20,
      burst_download_mbps: 100, burst_upload_mbps: 40,
      burst_threshold_mbps: null, burst_time_seconds: 10,
      radius_vendor: 'mikrotik',
    });
    expect(attrs['Mikrotik-Rate-Limit']).toBe('50M/20M 100M/40M 50M/20M 10');
  });

  it('generates generic WISPr attributes when vendor is null', () => {
    const attrs = generateAttributes({
      download_speed_mbps: 10, upload_speed_mbps: 5,
      radius_vendor: null,
    });
    expect(attrs).toHaveProperty('WISPr-Bandwidth-Max-Down', 10000000);
    expect(attrs).toHaveProperty('WISPr-Bandwidth-Max-Up', 5000000);
  });
});

// ===========================================================================
// qosService — rate string builder
// ===========================================================================

describe('qosService.buildRateString()', () => {
  const { buildRateString } = require('../src/services/qosService');

  it('builds MikroTik rate string with defaults', () => {
    const s = buildRateString({ radius_vendor: 'mikrotik', download_mbps: 30, upload_mbps: 15 });
    expect(s).toBe('30M/15M 60M/30M 30M/15M 8');
  });

  it('builds MikroTik rate string with explicit burst params', () => {
    const s = buildRateString({
      radius_vendor: 'mikrotik', download_mbps: 100, upload_mbps: 50,
      burst_download_mbps: 150, burst_upload_mbps: 75,
      burst_threshold_mbps: 90, burst_time_seconds: 12,
    });
    expect(s).toBe('100M/50M 150M/75M 90M/90M 12');
  });

  it('builds Cisco rate string', () => {
    const s = buildRateString({ radius_vendor: 'cisco', download_mbps: 20, upload_mbps: 10 });
    expect(s).toContain('ISP_DL_20M');
    expect(s).toContain('ISP_UL_10M');
  });

  it('builds Juniper rate string', () => {
    const s = buildRateString({ radius_vendor: 'juniper', download_mbps: 20, upload_mbps: 10 });
    expect(s).toBe('ISP_20M_10M');
  });

  it('builds generic rate string', () => {
    const s = buildRateString({ radius_vendor: 'generic', download_mbps: 10, upload_mbps: 5 });
    expect(s).toContain('10000000');
  });
});
