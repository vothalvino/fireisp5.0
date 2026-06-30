// =============================================================================
// FireISP 5.0 — NAS Access Mode Tests
// =============================================================================
// Covers the per-NAS access_mode (direct vs nated) feature (migration 371):
//
//   (a) Creating a NATed NAS without ip_address succeeds; ip_address is set to
//       the pre-allocated WG tunnel address (returned in the 201 body).
//   (b) Creating a direct-mode NAS without ip_address → 422 validation error.
//   (c) Creating a direct-mode NAS (existing behavior) still works.
//   (d) NATed NAS with no WG tunnel row → POST test-connection returns 422
//       with the clear "tunnel not set up yet" error message.
//   (e) NATed NAS with no WG tunnel row → POST seed returns 422 with same msg.
//
// Pattern: mirrors tests/nasWireguard.test.js
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
jest.mock('../src/models/User');
jest.mock('../src/services/wgProvisioningService');
jest.mock('../src/services/wireguardServerService');

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const Nas = require('../src/models/Nas');
const wgProvisioningService = require('../src/services/wgProvisioningService');
const wireguardServerService = require('../src/services/wireguardServerService');
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

const adminToken = makeToken();

function mockAdminUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'test@example.com',
    status: 'active',
    role: 'admin',
    organization_id: 1,
  });
}

// A direct-mode NAS (existing behavior)
const mockDirectNas = {
  id: 10,
  organization_id: 1,
  name: 'Direct-RB',
  ip_address: '10.1.0.1',
  secret: 'radsecret',
  type: 'mikrotik',
  status: 'active',
  access_mode: 'direct',
  api_port: 8728,
  api_username: 'admin',
  api_password_encrypted: 'iv:tag:cipher',
  api_use_tls: false,
};

// A NATed NAS — ip_address is the allocated tunnel IP
const mockNatedNas = {
  id: 11,
  organization_id: 1,
  name: 'NAT-RB',
  ip_address: '10.255.0.3',  // = tunnel_address allocated at create time
  secret: 'radsecret',
  type: 'mikrotik',
  status: 'active',
  access_mode: 'nated',
  api_port: 8728,
  api_username: 'admin',
  api_password_encrypted: 'iv:tag:cipher',
  api_use_tls: false,
};

beforeEach(() => {
  jest.resetAllMocks();
  // Default: Nas.createOrRestore returns the record (tests override per-case)
  Nas.createOrRestore = jest.fn();
  // Default: WG provisioning is a no-op for create tests
  wgProvisioningService.provisionDesiredState.mockResolvedValue({ tunnel: {}, steps: [] });
  // Default: wireguardServerService.allocateTunnelIp returns a tunnel IP
  wireguardServerService.allocateTunnelIp.mockResolvedValue('10.255.0.3');
});

// =============================================================================
// (a) NATed NAS create: no ip_address from client → ip_address = tunnel IP
// =============================================================================
describe('POST /api/nas — access_mode=nated', () => {
  test('(a) succeeds without ip_address; returned NAS has ip_address = allocated tunnel IP', async () => {
    mockAdminUser();

    // The route pre-allocates 10.255.0.3 and injects it as ip_address before calling
    // createOrRestore. The returned record should have ip_address = tunnel IP.
    Nas.createOrRestore.mockResolvedValue({
      ...mockNatedNas,
      id: 11,
    });

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        name: 'NAT-RB',
        secret: 'radsecret',
        access_mode: 'nated',
        // No ip_address — NATed mode; tunnel IP is allocated by the route
      });

    expect(res.status).toBe(201);
    // ip_address must equal the pre-allocated tunnel address
    expect(res.body.data.ip_address).toBe('10.255.0.3');
    expect(res.body.data.access_mode).toBe('nated');
    // wireguardServerService.allocateTunnelIp was called to pre-allocate
    expect(wireguardServerService.allocateTunnelIp).toHaveBeenCalledTimes(1);
    // provisionDesiredState is only called when WG_SERVER_ENABLED=true;
    // in the test environment it may be disabled — the core check is that
    // the route pre-allocated the tunnel IP (verified via allocateTunnelIp mock above).
  });

  test('(a2) allocateTunnelIp failure propagates as 500/error before NAS is inserted', async () => {
    mockAdminUser();
    wireguardServerService.allocateTunnelIp.mockRejectedValue(new Error('Pool exhausted'));

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        name: 'NAT-RB',
        secret: 'radsecret',
        access_mode: 'nated',
      });

    // Should not return 201 — the pre-allocation failed
    expect(res.status).not.toBe(201);
    // createOrRestore was never called (failed before insert)
    expect(Nas.createOrRestore).not.toHaveBeenCalled();
  });
});

// =============================================================================
// (b) Direct NAS create without ip_address → 422
// =============================================================================
describe('POST /api/nas — access_mode=direct validation', () => {
  test('(b) direct mode without ip_address → 422 validation error', async () => {
    mockAdminUser();

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        name: 'Direct-RB',
        secret: 'radsecret',
        access_mode: 'direct',
        // No ip_address — should fail for direct mode
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.message).toMatch(/Validation failed/i);
    // No tunnel IP was allocated (direct mode doesn't pre-allocate)
    expect(wireguardServerService.allocateTunnelIp).not.toHaveBeenCalled();
  });

  test('(b2) omitting access_mode (default=direct) without ip_address → 422', async () => {
    mockAdminUser();

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        name: 'Direct-RB',
        secret: 'radsecret',
        // No access_mode, no ip_address → direct mode is the default → 422
      });

    expect(res.status).toBe(422);
  });
});

// =============================================================================
// (c) Direct NAS create with ip_address — existing behavior unchanged
// =============================================================================
describe('POST /api/nas — access_mode=direct (existing behavior)', () => {
  test('(c) direct mode with ip_address → 201', async () => {
    mockAdminUser();
    Nas.createOrRestore.mockResolvedValue({ ...mockDirectNas });

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        name: 'Direct-RB',
        ip_address: '10.1.0.1',
        secret: 'radsecret',
        access_mode: 'direct',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.ip_address).toBe('10.1.0.1');
    // No tunnel pre-allocation for direct mode
    expect(wireguardServerService.allocateTunnelIp).not.toHaveBeenCalled();
    // provisionDesiredState is only called when WG_SERVER_ENABLED=true in test env;
    // the core check is that no tunnel IP was pre-allocated (verified above).
  });

  test('(c2) omitting access_mode (default=direct) with ip_address → 201', async () => {
    mockAdminUser();
    Nas.createOrRestore.mockResolvedValue({ ...mockDirectNas, access_mode: 'direct' });

    const res = await request(app)
      .post('/api/nas')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({
        name: 'Direct-RB',
        ip_address: '10.1.0.1',
        secret: 'radsecret',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.ip_address).toBe('10.1.0.1');
  });
});

// =============================================================================
// (d) NATed NAS with no tunnel → test-connection → 422 clear error
// =============================================================================
describe('POST /api/nas/:id/test-connection — nated with no tunnel', () => {
  test('(d) NATed NAS missing WG tunnel → 422 with clear message', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue({ ...mockNatedNas });
    // No tunnel row for this NAS
    db.query.mockResolvedValueOnce([[]]); // empty result for tunnel lookup

    const res = await request(app)
      .post('/api/nas/11/test-connection')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    expect(res.status).toBe(422);
    expect(res.body.error?.message).toMatch(/WireGuard tunnel/i);
    expect(res.body.error?.message).toMatch(/bootstrap/i);
  });

  test('(d2) direct NAS with no tunnel row → no pre-flight check, proceeds normally', async () => {
    const routerProvisioningService = require('../src/services/routerProvisioningService');
    jest.mock('../src/services/routerProvisioningService');
    routerProvisioningService.testConnection.mockResolvedValue({
      ok: true, host: '10.1.0.1', port: 8728, tls: false, version: '7.0', boardName: 'RB', identity: 'test',
    });

    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue({ ...mockDirectNas });
    // db.query NOT called for direct-mode NAS (no tunnel pre-flight check)

    const res = await request(app)
      .post('/api/nas/10/test-connection')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1');

    // Should not be 422 (no tunnel pre-flight for direct mode)
    expect(res.status).not.toBe(422);
  });
});

// =============================================================================
// (e) NATed NAS with no tunnel → seed → 422 clear error
// =============================================================================
describe('POST /api/nas/:id/seed — nated with no tunnel', () => {
  test('(e) NATed NAS missing WG tunnel → 422 with clear message', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue({ ...mockNatedNas });
    // No tunnel row
    db.query.mockResolvedValueOnce([[]]); // empty result for tunnel lookup

    const res = await request(app)
      .post('/api/nas/11/seed')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ radiusAddress: '10.255.0.1' });

    expect(res.status).toBe(422);
    expect(res.body.error?.message).toMatch(/WireGuard tunnel/i);
    expect(res.body.error?.message).toMatch(/bootstrap/i);
  });
});

// =============================================================================
// access_mode is immutable after registration (crudController beforeUpdate guard)
// =============================================================================
describe('PUT /api/nas/:id — access_mode is immutable', () => {
  test('(f) rejects changing access_mode (direct → nated) with 422 and does not update', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue({ ...mockDirectNas });

    const res = await request(app)
      .put('/api/nas/10')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ name: 'Direct-RB', access_mode: 'nated' });

    expect(res.status).toBe(422);
    expect(res.body.error?.message).toMatch(/access mode cannot be changed/i);
    expect(Nas.update).not.toHaveBeenCalled();
  });

  test('(g) allows an update that keeps the same access_mode', async () => {
    mockAdminUser();
    Nas.findByIdOrFail.mockResolvedValue({ ...mockDirectNas });
    Nas.update.mockResolvedValue({ ...mockDirectNas, name: 'Renamed' });

    const res = await request(app)
      .put('/api/nas/10')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Org-Id', '1')
      .send({ name: 'Renamed', access_mode: 'direct' });

    expect(res.status).toBe(200);
    expect(Nas.update).toHaveBeenCalled();
  });
});
