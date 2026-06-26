// =============================================================================
// FireISP 5.0 — WireGuard User-Peer Route Tests (§6d / plan §9)
// =============================================================================
// Supertest coverage for src/routes/wgPeers.js:
//   - POST   /wg-peers                  create returns config+QR; data never contains key columns
//   - GET    /wg-peers                  list redacts key columns
//   - GET    /wg-peers/:id/config       owner can download .conf or QR; non-owner → 404
//   - DELETE /wg-peers/:id              self-revoke; non-owner → 404
//   - GET    /wg-peers/admin/all        admin list; key columns always absent
//   - DELETE /wg-peers/admin/:id        admin revoke; 403 without wireguard.peers.admin
//   - POST   /wg-peers/admin/:id/rotate admin rotate; response never contains key columns
//   - GET    /wg-peers/admin/assignments/:userId  admin view scopes
//   - PUT    /wg-peers/admin/assignments/:userId  replace scopes; triggers refreshUserPeers;
//                                                 403 without wireguard.assignments.manage
//
// Pattern: mirrors tests/nasRouterProvisioning.test.js
// =============================================================================

// Mock the database module before requiring anything else
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/models/User');
jest.mock('../src/services/userTunnelService');
jest.mock('../src/services/wireguardServerService');
jest.mock('../src/services/userTunnelScopeService');
jest.mock('../src/utils/encryption', () => ({
  encrypt: jest.fn().mockReturnValue('iv:tag:cipher'),
  decrypt: jest.fn().mockReturnValue('PLAINTEXTPRIVKEY=='),
}));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/config/database');
const User = require('../src/models/User');
const userTunnelService = require('../src/services/userTunnelService');
const wireguardServerService = require('../src/services/wireguardServerService');
const userTunnelScopeService = require('../src/services/userTunnelScopeService');
const { decrypt } = require('../src/utils/encryption');
const app = require('../src/app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeToken(payload = {}) {
  return jwt.sign(
    { sub: 1, email: 'admin@test.com', role: 'admin', orgId: 1, ...payload },
    config.jwt.secret,
    { expiresIn: '1h' },
  );
}

const adminToken = makeToken();
// Technician (sub:2) — used for permission-gating tests
const techToken  = makeToken({ sub: 2, email: 'tech@test.com', role: 'technician' });

function mockAdminUser() {
  User.findById.mockResolvedValue({
    id: 1,
    email: 'admin@test.com',
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

// A peer row as it would appear in the DB (includes encrypted key columns)
const mockPeerRow = {
  id: 10,
  organization_id: 1,
  user_id: 1,
  name: 'Laptop',
  public_key: 'BASE64PUBKEY==',
  private_key_encrypted: 'iv:tag:cipher',
  preshared_key_encrypted: null,
  tunnel_address: '10.99.0.5',
  allowed_ips_snapshot: JSON.stringify(['192.168.1.0/24']),
  server_peer_synced: 1,
  last_handshake_at: null,
  rx_bytes: null,
  tx_bytes: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-01T00:00:00.000Z',
  deleted_at: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  // Default stub so the admin/all route does not throw when readPeerHandshakes is not set up
  wireguardServerService.readPeerHandshakes.mockResolvedValue({});
});

// =============================================================================
// POST /api/wg-peers — create peer
// =============================================================================
describe('POST /api/wg-peers', () => {
  test('201 returns config+QR; data.private_key_encrypted is absent', async () => {
    mockAdminUser();

    // The route calls createPeer and returns its {peer, config, config_base64, qr_svg}
    // The route's redactPeer strips key columns from peer before sending
    const redactedPeer = { ...mockPeerRow };
    delete redactedPeer.private_key_encrypted;
    delete redactedPeer.preshared_key_encrypted;

    userTunnelService.createPeer.mockResolvedValue({
      peer: redactedPeer,
      config: '[Interface]\nPrivateKey = PLAINTEXTPRIVKEY==\nAddress    = 10.99.0.5/32\n',
      config_base64: Buffer.from('[Interface]\n').toString('base64'),
      qr_svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    });

    const res = await request(app)
      .post('/api/wg-peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Laptop' });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Laptop');
    expect(res.body.data.tunnel_address).toBe('10.99.0.5');
    // Config text and QR must be present
    expect(res.body.config).toMatch(/\[Interface\]/);
    expect(res.body.config_base64).toBeTruthy();
    expect(res.body.qr_svg).toMatch(/<svg/);
    // Key columns must NEVER appear in the response
    expect(res.body.data).not.toHaveProperty('private_key_encrypted');
    expect(res.body.data).not.toHaveProperty('preshared_key_encrypted');
    // Service called with correct arguments
    expect(userTunnelService.createPeer).toHaveBeenCalledWith(1, 1, 'admin', 'Laptop');
  });

  test('201 response data still has no key columns even if service returns them', async () => {
    mockAdminUser();
    // Simulate a service implementation that erroneously returns key fields;
    // redactPeer() in the route must strip them before sending.
    userTunnelService.createPeer.mockResolvedValue({
      peer: { ...mockPeerRow }, // includes private_key_encrypted
      config: '[Interface]\n',
      config_base64: 'aQ==',
      qr_svg: '<svg></svg>',
    });

    const res = await request(app)
      .post('/api/wg-peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Phone' });

    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('private_key_encrypted');
    expect(res.body.data).not.toHaveProperty('preshared_key_encrypted');
  });

  test('422 when name is absent (validate middleware)', async () => {
    mockAdminUser();

    const res = await request(app)
      .post('/api/wg-peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(userTunnelService.createPeer).not.toHaveBeenCalled();
  });

  test('422 when name is an empty string (min:1 rule)', async () => {
    mockAdminUser();

    const res = await request(app)
      .post('/api/wg-peers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: '' });

    expect(res.status).toBe(422);
    expect(userTunnelService.createPeer).not.toHaveBeenCalled();
  });

  test('401 without auth token', async () => {
    const res = await request(app).post('/api/wg-peers').send({ name: 'Laptop' });
    expect(res.status).toBe(401);
  });

  test('403 when technician lacks wireguard.peers.create', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue([]); // no permissions at all

    const res = await request(app)
      .post('/api/wg-peers')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ name: 'Laptop' });

    expect(res.status).toBe(403);
    expect(userTunnelService.createPeer).not.toHaveBeenCalled();
  });
});

// =============================================================================
// GET /api/wg-peers — list own peers
// =============================================================================
describe('GET /api/wg-peers', () => {
  test('200 returns peer list; key columns absent from every row', async () => {
    mockAdminUser();
    // The route queries DB directly and applies redactPeer to each row
    db.query.mockResolvedValueOnce([[mockPeerRow, { ...mockPeerRow, id: 11 }]]);

    const res = await request(app)
      .get('/api/wg-peers')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    for (const row of res.body.data) {
      expect(row).not.toHaveProperty('private_key_encrypted');
      expect(row).not.toHaveProperty('preshared_key_encrypted');
    }
    expect(res.body.data[0].tunnel_address).toBe('10.99.0.5');
  });

  test('200 returns empty array when user has no peers', async () => {
    mockAdminUser();
    db.query.mockResolvedValueOnce([[]]); // no rows

    const res = await request(app)
      .get('/api/wg-peers')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  test('401 without auth token', async () => {
    const res = await request(app).get('/api/wg-peers');
    expect(res.status).toBe(401);
  });

  test('403 when technician lacks wireguard.peers.view', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/wg-peers')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(403);
  });

  test('200 when technician has wireguard.peers.view', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue(['wireguard.peers.view']);
    db.query.mockResolvedValueOnce([[]]); // no peers yet

    const res = await request(app)
      .get('/api/wg-peers')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(200);
  });
});

// =============================================================================
// GET /api/wg-peers/:id/config — profile re-download (owner-scoped)
// =============================================================================
describe('GET /api/wg-peers/:id/config', () => {
  test('200 returns .conf text for the peer owner', async () => {
    mockAdminUser();

    db.query.mockResolvedValueOnce([[mockPeerRow]]); // ownership check
    decrypt.mockReturnValue('PLAINTEXTPRIVKEY==');
    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.1.0/24']);
    userTunnelService.buildConfig.mockReturnValue('[Interface]\nPrivateKey = PLAINTEXTPRIVKEY==\nAddress    = 10.99.0.5/32\n[Peer]\n');

    const res = await request(app)
      .get('/api/wg-peers/10/config')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('[Interface]');
    expect(res.text).toContain('[Peer]');
    expect(userTunnelService.buildConfig).toHaveBeenCalledWith(
      expect.objectContaining({ tunnel_address: '10.99.0.5' }),
      'PLAINTEXTPRIVKEY==',
      ['192.168.1.0/24'],
      null, // no PSK on mockPeerRow
    );
  });

  test('200 returns SVG when format=qr', async () => {
    mockAdminUser();

    db.query.mockResolvedValueOnce([[mockPeerRow]]);
    decrypt.mockReturnValue('PLAINTEXTPRIVKEY==');
    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.1.0/24']);
    userTunnelService.buildConfig.mockReturnValue('[Interface]\n');
    userTunnelService.buildQr.mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>',
    );

    const res = await request(app)
      .get('/api/wg-peers/10/config?format=qr')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(res.body.toString()).toContain('<svg');
  });

  test('Content-Disposition attachment header set when download=1', async () => {
    mockAdminUser();

    db.query.mockResolvedValueOnce([[mockPeerRow]]);
    decrypt.mockReturnValue('KEY==');
    userTunnelScopeService.getScopedSubnets.mockResolvedValue([]);
    userTunnelService.buildConfig.mockReturnValue('[Interface]\n');

    const res = await request(app)
      .get('/api/wg-peers/10/config?download=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/wg-Laptop\.conf/);
  });

  test('404 when peer belongs to a different user (owner isolation)', async () => {
    mockAdminUser();

    // DB returns empty because WHERE user_id=req.user.id does not match the stored user_id
    db.query.mockResolvedValueOnce([[]]); // no row found for this user

    const res = await request(app)
      .get('/api/wg-peers/10/config')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    // Neither decrypt nor buildConfig should have been called
    expect(decrypt).not.toHaveBeenCalled();
    expect(userTunnelService.buildConfig).not.toHaveBeenCalled();
  });

  test('401 without auth token', async () => {
    const res = await request(app).get('/api/wg-peers/10/config');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// DELETE /api/wg-peers/:id — self-revoke (owner only)
// =============================================================================
describe('DELETE /api/wg-peers/:id', () => {
  test('204 on successful self-revoke', async () => {
    mockAdminUser();

    db.query.mockResolvedValueOnce([[{ id: 10 }]]); // ownership check passes
    userTunnelService.revokePeer.mockResolvedValue(true);

    const res = await request(app)
      .delete('/api/wg-peers/10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
    expect(userTunnelService.revokePeer).toHaveBeenCalledWith('10', 1, 1);
  });

  test('404 when peer belongs to a different user (ownership guard)', async () => {
    mockAdminUser();

    // Ownership check: WHERE user_id = req.user.id returns no row
    db.query.mockResolvedValueOnce([[]]); // no peer for this user

    const res = await request(app)
      .delete('/api/wg-peers/10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    // revokePeer must NOT be called — the ownership guard fires first
    expect(userTunnelService.revokePeer).not.toHaveBeenCalled();
  });

  test('401 without auth token', async () => {
    const res = await request(app).delete('/api/wg-peers/10');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/wg-peers/admin/all — admin list (all org peers + live stats)
// =============================================================================
describe('GET /api/wg-peers/admin/all', () => {
  test('200 returns paginated peer list; key columns absent', async () => {
    mockAdminUser();

    db.query
      .mockResolvedValueOnce([[mockPeerRow]])  // main peer JOIN users query
      .mockResolvedValueOnce([[{ total: 1 }]]); // COUNT query

    wireguardServerService.readPeerHandshakes.mockResolvedValue({});

    const res = await request(app)
      .get('/api/wg-peers/admin/all')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    // Key columns must NEVER appear, even in admin responses
    expect(res.body.data[0]).not.toHaveProperty('private_key_encrypted');
    expect(res.body.data[0]).not.toHaveProperty('preshared_key_encrypted');
  });

  test('live handshake stats are merged into admin rows when available', async () => {
    mockAdminUser();

    db.query
      .mockResolvedValueOnce([[mockPeerRow]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    wireguardServerService.readPeerHandshakes.mockResolvedValue({
      'BASE64PUBKEY==': {
        lastHandshakeUnix: 1700000000,
        rxBytes: 4096,
        txBytes: 2048,
        endpoint: '203.0.113.5:51234',
      },
    });

    const res = await request(app)
      .get('/api/wg-peers/admin/all')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].live_last_handshake_unix).toBe(1700000000);
    expect(res.body.data[0].live_rx_bytes).toBe(4096);
    expect(res.body.data[0].live_endpoint).toBe('203.0.113.5:51234');
  });

  test('readPeerHandshakes failure is non-fatal; peers still returned', async () => {
    mockAdminUser();

    db.query
      .mockResolvedValueOnce([[mockPeerRow]])
      .mockResolvedValueOnce([[{ total: 1 }]]);

    wireguardServerService.readPeerHandshakes.mockRejectedValue(new Error('wg not installed'));

    const res = await request(app)
      .get('/api/wg-peers/admin/all')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].live_last_handshake_unix).toBeNull();
  });

  test('403 when user lacks wireguard.peers.admin (technician with peers.view only)', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue(['wireguard.peers.view']); // not admin perm

    const res = await request(app)
      .get('/api/wg-peers/admin/all')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(403);
  });

  test('401 without auth token', async () => {
    const res = await request(app).get('/api/wg-peers/admin/all');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// DELETE /api/wg-peers/admin/:id — admin revoke any peer
// =============================================================================
describe('DELETE /api/wg-peers/admin/:id', () => {
  test('204 on successful admin revoke', async () => {
    mockAdminUser();
    userTunnelService.revokePeer.mockResolvedValue(true);

    const res = await request(app)
      .delete('/api/wg-peers/admin/10')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(204);
    // Admin revoke passes the caller's user id as revokedBy
    expect(userTunnelService.revokePeer).toHaveBeenCalledWith('10', 1, 1);
  });

  test('403 when technician lacks wireguard.peers.admin', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue([]);

    const res = await request(app)
      .delete('/api/wg-peers/admin/10')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(403);
    expect(userTunnelService.revokePeer).not.toHaveBeenCalled();
  });

  test('401 without auth token', async () => {
    const res = await request(app).delete('/api/wg-peers/admin/10');
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// POST /api/wg-peers/admin/:id/rotate — replace keypair (admin)
// =============================================================================
describe('POST /api/wg-peers/admin/:id/rotate', () => {
  test('200 returns redacted peer with new public key; key columns absent', async () => {
    mockAdminUser();

    // Service returns the updated row — without key fields (as rotatePeer does)
    const rotatedPeer = { ...mockPeerRow, public_key: 'NEWPUBKEY==' };
    delete rotatedPeer.private_key_encrypted;
    delete rotatedPeer.preshared_key_encrypted;

    userTunnelService.rotatePeer.mockResolvedValue(rotatedPeer);

    const res = await request(app)
      .post('/api/wg-peers/admin/10/rotate')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.public_key).toBe('NEWPUBKEY==');
    expect(res.body.data).not.toHaveProperty('private_key_encrypted');
    expect(res.body.data).not.toHaveProperty('preshared_key_encrypted');
    expect(userTunnelService.rotatePeer).toHaveBeenCalledWith('10', 1, 1);
  });

  test('route applies redactPeer even when service returns key fields', async () => {
    mockAdminUser();

    // Service erroneously returns key fields — route must strip them
    userTunnelService.rotatePeer.mockResolvedValue({ ...mockPeerRow });

    const res = await request(app)
      .post('/api/wg-peers/admin/10/rotate')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).not.toHaveProperty('private_key_encrypted');
    expect(res.body.data).not.toHaveProperty('preshared_key_encrypted');
  });

  test('403 when technician lacks wireguard.peers.admin', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/wg-peers/admin/10/rotate')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(403);
    expect(userTunnelService.rotatePeer).not.toHaveBeenCalled();
  });
});

// =============================================================================
// GET /api/wg-peers/admin/assignments/:userId — view current scopes
// =============================================================================
describe('GET /api/wg-peers/admin/assignments/:userId', () => {
  test('200 returns assignment rows + computed subnets', async () => {
    mockAdminUser();

    db.query
      .mockResolvedValueOnce([[{ id: 50, scope_type: 'nas', scope_id: 7, nas_name: 'Core-RB' }]]) // una JOIN (org-scoped)
      .mockResolvedValueOnce([[{ role: 'technician' }]]); // org-scoped user role lookup (organization_users)

    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.10.0/24']);

    const res = await request(app)
      .get('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.computed_subnets).toEqual(['192.168.10.0/24']);
  });

  test('403 when user lacks wireguard.assignments.manage', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue([]);

    const res = await request(app)
      .get('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${techToken}`);

    expect(res.status).toBe(403);
  });
});

// =============================================================================
// PUT /api/wg-peers/admin/assignments/:userId — replace scopes + live-refresh
// =============================================================================
describe('PUT /api/wg-peers/admin/assignments/:userId', () => {
  test('200 replaces scopes and triggers refreshUserPeers for the target user', async () => {
    mockAdminUser();

    db.query
      .mockResolvedValueOnce([[{ id: 7 }]])                       // validate nas:7 in org
      .mockResolvedValueOnce([[{ id: 3 }]])                       // validate site:3 in org
      .mockResolvedValueOnce([{ affectedRows: 2 }])               // soft-delete existing
      .mockResolvedValueOnce([{ insertId: 50, affectedRows: 1 }]) // INSERT scope 1
      .mockResolvedValueOnce([{ insertId: 51, affectedRows: 1 }]) // INSERT scope 2
      .mockResolvedValueOnce([[                                    // SELECT new assignments
        { id: 50, scope_type: 'nas',  scope_id: 7 },
        { id: 51, scope_type: 'site', scope_id: 3 },
      ]]);

    userTunnelService.refreshUserPeers.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        scopes: [
          { scope_type: 'nas',  scope_id: 7 },
          { scope_type: 'site', scope_id: 3 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    // refreshUserPeers must be called with the target user id (string from URL params)
    expect(userTunnelService.refreshUserPeers).toHaveBeenCalledWith('42');
  });

  test('200 with empty scopes array clears all assignments', async () => {
    mockAdminUser();

    db.query
      .mockResolvedValueOnce([{ affectedRows: 3 }]) // soft-delete
      .mockResolvedValueOnce([[]]); // SELECT new assignments (empty)

    userTunnelService.refreshUserPeers.mockResolvedValue(undefined);

    const res = await request(app)
      .put('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scopes: [] });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(userTunnelService.refreshUserPeers).toHaveBeenCalledWith('42');
  });

  test('422 when scopes field is absent from request body', async () => {
    mockAdminUser();

    const res = await request(app)
      .put('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(422);
    expect(userTunnelService.refreshUserPeers).not.toHaveBeenCalled();
  });

  test('422 when a scope element has an invalid scope_type', async () => {
    mockAdminUser();

    const res = await request(app)
      .put('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scopes: [{ scope_type: 'region', scope_id: 1 }] });

    expect(res.status).toBe(422);
    expect(userTunnelService.refreshUserPeers).not.toHaveBeenCalled();
  });

  test('422 when scope_id is not a positive integer', async () => {
    mockAdminUser();

    const res = await request(app)
      .put('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ scopes: [{ scope_type: 'nas', scope_id: 0 }] });

    expect(res.status).toBe(422);
    expect(userTunnelService.refreshUserPeers).not.toHaveBeenCalled();
  });

  test('403 when technician lacks wireguard.assignments.manage', async () => {
    mockTechUser();
    User.getPermissions.mockResolvedValue(['wireguard.peers.view']); // unrelated perm

    const res = await request(app)
      .put('/api/wg-peers/admin/assignments/42')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ scopes: [{ scope_type: 'nas', scope_id: 1 }] });

    expect(res.status).toBe(403);
    expect(userTunnelService.refreshUserPeers).not.toHaveBeenCalled();
  });

  test('401 without auth token', async () => {
    const res = await request(app)
      .put('/api/wg-peers/admin/assignments/42')
      .send({ scopes: [] });
    expect(res.status).toBe(401);
  });
});
