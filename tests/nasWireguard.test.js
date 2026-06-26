// =============================================================================
// FireISP 5.0 — NAS WireGuard Route Tests (plan §9)
// =============================================================================
// Supertest HTTP-level coverage for the NAS WireGuard endpoints in
// src/routes/nas.js:
//
//   GET  /api/nas/:id/wg             — fetch tunnel state (redacted)
//   POST /api/nas/:id/wg/bootstrap   — push config or return snippet
//   POST /api/nas/:id/wg/discover    — read connected subnets (read-only)
//   PUT  /api/nas/:id/wg/routes      — confirm + store routed CIDRs
//
// Test matrix:
//   (a) On routerUnreachable, bootstrap returns HTTP 200 with {method:'snippet', snippet}
//       and the tunnel DB state is set to 'manual' (no throw / no 502).
//   (b) Permission gating — requests without devices.update are rejected (403).
//   (c) GET /:id/wg NEVER returns nas_private_key_encrypted (redactTunnel guard).
//
// Pattern: mirrors tests/nasRouterProvisioning.test.js
// =============================================================================

// Mock the database before requiring anything else
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/Nas');
jest.mock('../src/services/wgProvisioningService');
jest.mock('../src/models/User');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const Nas = require('../src/models/Nas');
const wgProvisioningService = require('../src/services/wgProvisioningService');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers (mirror nasRouterProvisioning.test.js)
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'test@example.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const adminToken = makeToken();
const techToken  = makeToken({ sub: 2, email: 'tech@test.com', role: 'technician' });

function mockAdminUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

function mockTechUser() {
  User.findById.mockResolvedValue({
    id: 2,
    email: 'tech@test.com',
    status: 'active',
    role: 'technician',
    organization_id: 1,
  });
}

const mockNas = {
  id: 7,
  organization_id: 1,
  name: 'Core-RB',
  ip_address: '10.10.0.1',
  type: 'mikrotik',
  status: 'active',
  api_port: 8728,
  api_username: 'fireisp',
  api_password_encrypted: 'iv:tag:cipher',
  api_use_tls: false,
};

// A tunnel row that includes the sensitive column (route must strip it)
const mockTunnelRow = {
  id: 3,
  nas_id: 7,
  organization_id: 1,
  tunnel_address: '10.255.0.2',
  nas_public_key: 'NASPUBKEY==',
  nas_private_key_encrypted: 'iv:tag:cipher',  // MUST be stripped by redactTunnel
  state: 'active',
  nas_config_method: 'api',
  routed_subnets: JSON.stringify(['192.168.10.0/24']),
  last_error: null,
  deleted_at: null,
};

beforeEach(() => {
  jest.resetAllMocks();
});

// =============================================================================
// GET /api/nas/:id/wg — fetch tunnel state (redacted)
// =============================================================================
describe('GET /api/nas/:id/wg', () => {
  test('200 returns tunnel data with nas_private_key_encrypted stripped', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);
    db.query.mockResolvedValueOnce([[mockTunnelRow]]);

    const res = await request(app)
      .get('/api/nas/7/wg')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // redactTunnel must have removed the private key column
    expect(res.body.data).not.toHaveProperty('nas_private_key_encrypted');
    // Other fields are present
    expect(res.body.data.tunnel_address).toBe('10.255.0.2');
    expect(res.body.data.nas_public_key).toBe('NASPUBKEY==');
    expect(res.body.data.state).toBe('active');
  });

  test('200 with data:null when no tunnel record exists yet', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);
    db.query.mockResolvedValueOnce([[]]); // no tunnel row

    const res = await request(app)
      .get('/api/nas/7/wg')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  test('404 when NAS does not exist', async () => {
    mockAdminUser();
    const { NotFoundError } = require('../src/utils/errors');
    Nas.findByIdOrFail.mockRejectedValue(new NotFoundError('nas'));

    const res = await request(app)
      .get('/api/nas/999/wg')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(db.query).not.toHaveBeenCalled(); // NAS check failed before DB tunnel query
  });

  test('401 without auth token', async () => {
    const res = await request(app).get('/api/nas/7/wg');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/nas/:id/wg/bootstrap — push WG config or return snippet
// =============================================================================
describe('POST /api/nas/:id/wg/bootstrap', () => {
  test('(a) routerUnreachable → HTTP 200 with method:snippet + tunnel state manual', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);

    // Service resolves (no throw) with method:'snippet' — the route returns 200
    const snippetText = '# FireISP WireGuard snippet\n/interface/wireguard add name=wg-fireisp';
    wgProvisioningService.bootstrap.mockResolvedValue({
      method: 'snippet',
      snippet: snippetText,
      steps: [{ step: 'reachability', status: 'unreachable', detail: 'connect ETIMEDOUT' }],
    });

    const res = await request(app)
      .post('/api/nas/7/wg/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.method).toBe('snippet');
    expect(typeof res.body.data.snippet).toBe('string');
    expect(res.body.data.snippet).toContain('wg-fireisp');
    // The tunnel private key must never appear in the snippet response
    expect(JSON.stringify(res.body)).not.toContain('nas_private_key_encrypted');
  });

  test('200 when bootstrap succeeds via API', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);

    const redactedTunnel = { ...mockTunnelRow };
    delete redactedTunnel.nas_private_key_encrypted;

    wgProvisioningService.bootstrap.mockResolvedValue({
      method: 'api',
      steps: [
        { step: 'interface', status: 'created', detail: 'wg-fireisp created' },
        { step: 'address',   status: 'created', detail: '10.255.0.2/32' },
        { step: 'peer',      status: 'created', detail: 'server pub key' },
      ],
      tunnel: redactedTunnel,
    });

    const res = await request(app)
      .post('/api/nas/7/wg/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.method).toBe('api');
    expect(res.body.data.steps).toHaveLength(3);
    // redactTunnel applied — private key column must be absent
    expect(res.body.data.tunnel).not.toHaveProperty('nas_private_key_encrypted');
  });

  test('(b) 403 when user lacks devices.update', async () => {
    mockTechUser();
    // Technician has devices.view but NOT devices.update
    User.getPermissions.mockResolvedValue(['devices.view']);

    const res = await request(app)
      .post('/api/nas/7/wg/bootstrap')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(403);
    expect(wgProvisioningService.bootstrap).not.toHaveBeenCalled();
  });

  test('502 ROUTER_UNREACHABLE when service throws (non-snippet path)', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);

    // Service throws an unknown network error (not routerUnreachable flag) → 502
    wgProvisioningService.bootstrap.mockRejectedValue(
      new Error('connect ETIMEDOUT 10.10.0.1:8728'),
    );

    const res = await request(app)
      .post('/api/nas/7/wg/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('ROUTER_UNREACHABLE');
  });

  test('404 when NAS does not exist', async () => {
    mockAdminUser();
    const { NotFoundError } = require('../src/utils/errors');
    Nas.findByIdOrFail.mockRejectedValue(new NotFoundError('nas'));

    const res = await request(app)
      .post('/api/nas/999/wg/bootstrap')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(wgProvisioningService.bootstrap).not.toHaveBeenCalled();
  });

  test('401 without auth token', async () => {
    const res = await request(app).post('/api/nas/7/wg/bootstrap');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/nas/:id/wg/discover — read connected subnets (read-only)
// =============================================================================
describe('POST /api/nas/:id/wg/discover', () => {
  test('200 returns proposed subnets from router topology', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);

    wgProvisioningService.discoverSubnets.mockResolvedValue({
      proposed: ['192.168.10.0/24', '192.168.20.0/24'],
      topology: { routes: [], interfaces: [] },
    });

    const res = await request(app)
      .post('/api/nas/7/wg/discover')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.proposed).toEqual(['192.168.10.0/24', '192.168.20.0/24']);
  });

  test('(b) 403 when user lacks devices.update', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue(['devices.view']);

    const res = await request(app)
      .post('/api/nas/7/wg/discover')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(403);
    expect(wgProvisioningService.discoverSubnets).not.toHaveBeenCalled();
  });

  test('502 when router unreachable during discover', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);
    wgProvisioningService.discoverSubnets.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.10.0.1:8728'),
    );

    const res = await request(app)
      .post('/api/nas/7/wg/discover')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('ROUTER_UNREACHABLE');
  });

  test('401 without auth token', async () => {
    const res = await request(app).post('/api/nas/7/wg/discover');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// PUT /api/nas/:id/wg/routes — confirm + store routed CIDRs
// =============================================================================
describe('PUT /api/nas/:id/wg/routes', () => {
  test('200 confirms routes and returns updated tunnel (key column stripped)', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue(mockNas);

    const redactedTunnel = { ...mockTunnelRow, routed_subnets: JSON.stringify(['192.168.10.0/24']) };
    delete redactedTunnel.nas_private_key_encrypted;

    wgProvisioningService.confirmRoutes.mockResolvedValue({
      tunnel: redactedTunnel,
      steps: [{ step: 'routes', status: 'updated', detail: '1 subnet confirmed' }],
    });

    const res = await request(app)
      .put('/api/nas/7/wg/routes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ subnets: ['192.168.10.0/24'] });

    expect(res.status).toBe(200);
    expect(res.body.data.tunnel).not.toHaveProperty('nas_private_key_encrypted');
    expect(wgProvisioningService.confirmRoutes).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
      expect.objectContaining({ subnets: ['192.168.10.0/24'] }),
    );
  });

  test('(b) 403 when user lacks devices.update', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue(['devices.view']);

    const res = await request(app)
      .put('/api/nas/7/wg/routes')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ subnets: ['192.168.10.0/24'] });

    expect(res.status).toBe(403);
    expect(wgProvisioningService.confirmRoutes).not.toHaveBeenCalled();
  });

  test('422 when subnets field is missing', async () => {
    mockAdminUser();

    const res = await request(app)
      .put('/api/nas/7/wg/routes')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(wgProvisioningService.confirmRoutes).not.toHaveBeenCalled();
  });

  test('401 without auth token', async () => {
    const res = await request(app).put('/api/nas/7/wg/routes');
    expect(res.status).toBe(401);
  });
});
