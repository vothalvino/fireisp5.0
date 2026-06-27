// =============================================================================
// FireISP 5.0 — User Tunnel Service Unit Tests (§6b / plan §9)
// =============================================================================
// Covers src/services/userTunnelService.js:
//   buildConfig   — emits correct [Interface]/[Peer] sections; scoped AllowedIPs
//   buildQr       — returns SVG string from the WireGuard .conf text
//   rotatePeer    — generates new keypair; old key removed from hub; DB updated;
//                   NotFoundError thrown for unknown/revoked peers
//   refreshAffectedByNas — recomputes scope for assigned users + admins on NAS
//                          route change; exits early when NAS not found
// =============================================================================

// Mock all I/O before requiring anything else
jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

jest.mock('../src/config', () => ({
  log: { level: 'silent' },
  wireguard: {
    serverEnabled: false,
    serverInterface: 'wg-fireisp',
    serverEndpoint: 'vpn.example.com',
    serverListenPort: 51820,
    serverPublicKey: '',
    serverSubnet: '10.255.0.0/16',
    keepalive: 25,
    clientInterface: 'wg-clients',
    clientSubnet: '10.99.0.0/16',
    clientListenPort: 51821,
    clientPublicKey: '',
  },
}));

jest.mock('../src/services/wireguardServerService');
jest.mock('../src/services/userTunnelScopeService');
jest.mock('../src/services/auditLog');
jest.mock('../src/utils/encryption', () => ({
  encrypt: jest.fn().mockReturnValue('encrypted-ciphertext'),
  decrypt: jest.fn().mockReturnValue('DECRYPTED-PRIVKEY'),
}));
jest.mock('qrcode', () => ({
  toString: jest.fn(),
}));

const db = require('../src/config/database');
const wireguardServerService = require('../src/services/wireguardServerService');
const userTunnelScopeService = require('../src/services/userTunnelScopeService');
const auditLog = require('../src/services/auditLog');
const encryption = require('../src/utils/encryption');
const QRCode = require('qrcode');

// Require the module under test AFTER all mocks are registered
const userTunnelService = require('../src/services/userTunnelService');

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
const mockPeer = {
  id: 10,
  user_id: 1,
  organization_id: 1,
  name: 'Laptop',
  public_key: 'OLDPUBKEY==',
  private_key_encrypted: 'iv:tag:cipher',
  preshared_key_encrypted: null,
  tunnel_address: '10.99.0.5',
  allowed_ips_snapshot: JSON.stringify(['192.168.1.0/24']),
  server_peer_synced: 1,
  deleted_at: null,
  revoked_at: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  // Default stubs (overridden per test as needed)
  wireguardServerService.generateKeypair.mockReturnValue({
    privateKey: 'NEWPRIVKEY==',
    publicKey:  'NEWPUBKEY==',
  });
  wireguardServerService.removeUserPeer.mockResolvedValue({ applied: true });
  wireguardServerService.syncUserPeer.mockResolvedValue({ applied: true });
  wireguardServerService.setUserForwardScope.mockResolvedValue({ applied: true });
  userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.0.0/24']);
  auditLog.log.mockResolvedValue(undefined);
  encryption.encrypt.mockReturnValue('encrypted-ciphertext');
});

// =============================================================================
// buildConfig()
// =============================================================================
describe('buildConfig()', () => {
  test('emits [Interface] section with PrivateKey and Address', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'PLAINTEXTPRIVKEY==',
      ['192.168.1.0/24'],
    );

    expect(conf).toContain('[Interface]');
    expect(conf).toContain('PrivateKey = PLAINTEXTPRIVKEY==');
    expect(conf).toContain('Address    = 10.99.0.5/32');
  });

  test('emits [Peer] section with Endpoint, AllowedIPs, and PersistentKeepalive', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'PLAINTEXTPRIVKEY==',
      ['192.168.1.0/24', '10.0.0.0/8'],
    );

    expect(conf).toContain('[Peer]');
    expect(conf).toContain('AllowedIPs          = 192.168.1.0/24, 10.0.0.0/8');
    expect(conf).toContain('PersistentKeepalive = 25');
    expect(conf).toContain('Endpoint            = vpn.example.com:51821');
  });

  test('scoped subnets joined with ", " in AllowedIPs', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'KEY==',
      ['10.1.0.0/16', '10.2.0.0/16', '10.3.0.0/16'],
    );

    expect(conf).toContain('AllowedIPs          = 10.1.0.0/16, 10.2.0.0/16, 10.3.0.0/16');
  });

  test('falls back to tunnel_address/32 when subnets array is empty (non-routable scope)', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'KEY==',
      [],
    );

    // Empty scope → peer can only reach its own tunnel IP (reaches nothing on the network)
    expect(conf).toContain('AllowedIPs          = 10.99.0.5/32');
  });

  test('falls back to 127.0.0.1/32 when subnets empty and peer has no tunnel_address', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer, tunnel_address: null },
      'KEY==',
      [],
    );

    expect(conf).toContain('AllowedIPs          = 127.0.0.1/32');
  });

  test('includes PresharedKey line when PSK is provided', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'KEY==',
      ['192.168.0.0/24'],
      'PRESHARED-SECRET==',
    );

    expect(conf).toContain('PresharedKey        = PRESHARED-SECRET==');
  });

  test('omits PresharedKey line when PSK is null', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'KEY==',
      ['192.168.0.0/24'],
      null,
    );

    expect(conf).not.toContain('PresharedKey');
  });

  test('[Interface] section appears before [Peer] section', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'KEY==',
      ['10.0.0.0/8'],
    );

    const iface = conf.indexOf('[Interface]');
    const peer  = conf.indexOf('[Peer]');
    expect(iface).toBeGreaterThanOrEqual(0);
    expect(peer).toBeGreaterThan(iface);
  });

  test('PrivateKey value is the plaintext argument (not the encrypted DB column)', () => {
    // Guards against accidentally writing the encrypted value into the .conf
    const conf = userTunnelService.buildConfig(
      { ...mockPeer },
      'PLAINTEXT-PRIVATE-KEY',
      [],
    );

    expect(conf).toContain('PrivateKey = PLAINTEXT-PRIVATE-KEY');
    expect(conf).not.toContain('iv:tag:cipher'); // the encrypted column value
  });

  test('full_tunnel=1 → AllowedIPs is 0.0.0.0/0, ::/0 regardless of subnets', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer, full_tunnel: 1 },
      'KEY==',
      ['192.168.1.0/24', '10.0.0.0/8'], // subnets ignored in full-tunnel mode
    );

    expect(conf).toContain('AllowedIPs          = 0.0.0.0/0, ::/0');
    expect(conf).not.toContain('192.168.1.0/24');
    expect(conf).not.toContain('10.0.0.0/8');
  });

  test('full_tunnel=true → AllowedIPs is 0.0.0.0/0, ::/0 (truthy boolean form)', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer, full_tunnel: true },
      'KEY==',
      ['192.168.1.0/24'],
    );

    expect(conf).toContain('AllowedIPs          = 0.0.0.0/0, ::/0');
  });

  test('full_tunnel=0 → split-tunnel: uses subnets list', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer, full_tunnel: 0 },
      'KEY==',
      ['10.1.0.0/16', '10.2.0.0/16'],
    );

    // MUST use subnets, NOT the full-tunnel prefix
    expect(conf).toContain('AllowedIPs          = 10.1.0.0/16, 10.2.0.0/16');
    expect(conf).not.toContain('0.0.0.0/0');
  });

  test('full_tunnel=0 with empty subnets falls back to tunnel_address/32', () => {
    const conf = userTunnelService.buildConfig(
      { ...mockPeer, full_tunnel: 0 },
      'KEY==',
      [],
    );

    expect(conf).toContain('AllowedIPs          = 10.99.0.5/32');
    expect(conf).not.toContain('0.0.0.0/0');
  });

  test('peer without full_tunnel field (legacy row) behaves as split-tunnel', () => {
    // Existing peers backfilled to full_tunnel=0 by migration;
    // rows created before the column was added may have no field at all.
    const peerNoField = { ...mockPeer };
    delete peerNoField.full_tunnel;

    const conf = userTunnelService.buildConfig(peerNoField, 'KEY==', ['192.168.2.0/24']);

    expect(conf).toContain('AllowedIPs          = 192.168.2.0/24');
    expect(conf).not.toContain('0.0.0.0/0');
  });
});

// =============================================================================
// createPeer() — full_tunnel persistence
// =============================================================================
describe('createPeer() — full_tunnel flag', () => {
  const CREATED_PEER_ROW = {
    ...mockPeer,
    id: 55,
    full_tunnel: 1,
    public_key: 'NEWPUBKEY==',
    private_key_encrypted: 'encrypted-ciphertext',
  };

  function setupCreatePeerMocks(fullTunnelInRow = 1) {
    wireguardServerService.generateKeypair.mockReturnValue({
      privateKey: 'NEWPRIVKEY==',
      publicKey: 'NEWPUBKEY==',
    });
    wireguardServerService.allocateUserTunnelIp.mockResolvedValue('10.99.0.55');
    wireguardServerService.ensureBaseFirewall.mockResolvedValue({ applied: false });
    wireguardServerService.syncUserPeer.mockResolvedValue({ applied: true });
    wireguardServerService.setUserForwardScope.mockResolvedValue({ applied: true });
    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.1.0/24']);

    db.query
      .mockResolvedValueOnce([{ insertId: 55 }])                              // INSERT
      .mockResolvedValueOnce([[{ ...CREATED_PEER_ROW, full_tunnel: fullTunnelInRow }]]) // SELECT
      .mockResolvedValueOnce([{ affectedRows: 1 }]);                          // UPDATE server_peer_synced

    QRCode.toString.mockResolvedValue('<svg/>');
  }

  test('passes full_tunnel=1 to INSERT when called without explicit arg (default=true)', async () => {
    setupCreatePeerMocks(1);

    await userTunnelService.createPeer(1, 1, 'technician', 'Laptop');

    // The INSERT call must include 1 for the full_tunnel bind parameter
    const insertCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /INSERT INTO wg_user_peers/.test(sql),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall[1];
    // full_tunnel is at index 8 (0-based): orgId, userId, name, publicKey,
    // encrypted key, tunnelIp, endpoint, full_tunnel, allowed_ips_snapshot
    const fullTunnelParam = params[7]; // index 7 = full_tunnel
    expect(fullTunnelParam).toBe(1);
  });

  test('passes full_tunnel=0 to INSERT when fullTunnel=false is explicitly passed', async () => {
    setupCreatePeerMocks(0);

    await userTunnelService.createPeer(1, 1, 'technician', 'Laptop', false);

    const insertCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /INSERT INTO wg_user_peers/.test(sql),
    );
    expect(insertCall).toBeDefined();
    const params = insertCall[1];
    const fullTunnelParam = params[7]; // index 7 = full_tunnel
    expect(fullTunnelParam).toBe(0);
  });

  test('returned config uses 0.0.0.0/0,::/0 when peer row has full_tunnel=1', async () => {
    setupCreatePeerMocks(1);

    const result = await userTunnelService.createPeer(1, 1, 'technician', 'Laptop', true);

    expect(result.config).toContain('AllowedIPs          = 0.0.0.0/0, ::/0');
  });

  test('returned config uses scoped subnets when peer row has full_tunnel=0', async () => {
    setupCreatePeerMocks(0);
    // Override the SELECT to return full_tunnel=0
    db.query.mockReset();
    wireguardServerService.allocateUserTunnelIp.mockResolvedValue('10.99.0.55');
    wireguardServerService.ensureBaseFirewall.mockResolvedValue({ applied: false });
    wireguardServerService.syncUserPeer.mockResolvedValue({ applied: true });
    wireguardServerService.setUserForwardScope.mockResolvedValue({ applied: true });
    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.1.0/24']);

    db.query
      .mockResolvedValueOnce([{ insertId: 55 }])
      .mockResolvedValueOnce([[{ ...CREATED_PEER_ROW, full_tunnel: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    QRCode.toString.mockResolvedValue('<svg/>');

    const result = await userTunnelService.createPeer(1, 1, 'technician', 'Laptop', false);

    expect(result.config).toContain('AllowedIPs          = 192.168.1.0/24');
    expect(result.config).not.toContain('0.0.0.0/0');
  });
});

// =============================================================================
// buildQr()
// =============================================================================
describe('buildQr()', () => {
  test('returns the SVG string produced by QRCode.toString', async () => {
    const svgOutput = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
    QRCode.toString.mockResolvedValue(svgOutput);

    const result = await userTunnelService.buildQr('[Interface]\nPrivateKey = K\n');

    expect(result).toBe(svgOutput);
    expect(QRCode.toString).toHaveBeenCalledWith(
      '[Interface]\nPrivateKey = K\n',
      { type: 'svg' },
    );
  });

  test('the returned value contains <svg (basic SVG marker check)', async () => {
    QRCode.toString.mockResolvedValue('<svg><rect/></svg>');

    const result = await userTunnelService.buildQr('conf text');
    expect(result).toMatch(/<svg/);
  });
});

// =============================================================================
// rotatePeer()
// =============================================================================
describe('rotatePeer()', () => {
  function setupRotateDbMocks(updatedPublicKey = 'NEWPUBKEY==') {
    db.query
      .mockResolvedValueOnce([[{ ...mockPeer }]])                  // SELECT peer by id
      .mockResolvedValueOnce([{ affectedRows: 1 }])               // UPDATE public_key + encrypted key
      .mockResolvedValueOnce([[{ role: 'technician' }]])          // SELECT user role
      .mockResolvedValueOnce([{ affectedRows: 1 }])               // UPDATE server_peer_synced = 1
      .mockResolvedValueOnce([[{ ...mockPeer, public_key: updatedPublicKey }]]); // SELECT updated row
  }

  test('generates a new keypair and persists the new public key', async () => {
    setupRotateDbMocks();

    const result = await userTunnelService.rotatePeer(10, 1, 99);

    expect(wireguardServerService.generateKeypair).toHaveBeenCalled();
    // The UPDATE call must include the new public key
    const updateCall = db.query.mock.calls[1];
    expect(updateCall[1][0]).toBe('NEWPUBKEY=='); // first bind param = new public key
    expect(result.public_key).toBe('NEWPUBKEY==');
  });

  test('new private key is stored encrypted; encrypt is called', async () => {
    setupRotateDbMocks();

    await userTunnelService.rotatePeer(10, 1, 99);

    expect(encryption.encrypt).toHaveBeenCalledWith('NEWPRIVKEY==');
    // The encrypted value (not plaintext) goes into the UPDATE
    const updateCall = db.query.mock.calls[1];
    expect(updateCall[1][1]).toBe('encrypted-ciphertext');
  });

  test('removes old peer from WireGuard hub before adding new one', async () => {
    setupRotateDbMocks();

    await userTunnelService.rotatePeer(10, 1, 99);

    expect(wireguardServerService.removeUserPeer).toHaveBeenCalledWith({
      publicKey: 'OLDPUBKEY==',
      peerId: 10,
    });
    expect(wireguardServerService.syncUserPeer).toHaveBeenCalledWith({
      publicKey: 'NEWPUBKEY==',
      tunnelIp: '10.99.0.5',
    });
  });

  test('re-installs nft forward scope with same tunnel IP', async () => {
    setupRotateDbMocks();
    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['10.0.0.0/8']);

    await userTunnelService.rotatePeer(10, 1, 99);

    expect(wireguardServerService.setUserForwardScope).toHaveBeenCalledWith({
      peerId: 10,
      tunnelIp: '10.99.0.5',
      subnets: ['10.0.0.0/8'],
    });
  });

  test('hub sync errors are non-fatal; function still resolves', async () => {
    db.query
      .mockResolvedValueOnce([[{ ...mockPeer }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ role: 'technician' }]])
      // No UPDATE server_peer_synced — hub calls all throw
      .mockResolvedValueOnce([[{ ...mockPeer, public_key: 'NEWPUBKEY==' }]]); // final SELECT

    wireguardServerService.removeUserPeer.mockRejectedValue(new Error('wg not installed'));

    // Should resolve rather than reject (hub sync is best-effort)
    await expect(userTunnelService.rotatePeer(10, 1, 99)).resolves.toBeDefined();
  });

  test('throws NotFoundError when peer does not exist', async () => {
    db.query.mockResolvedValueOnce([[]]); // SELECT returns no row

    await expect(userTunnelService.rotatePeer(999, 1, 99))
      .rejects
      .toThrow('wg_user_peers not found');
  });

  test('throws NotFoundError for a revoked peer (revoked_at IS NULL guard)', async () => {
    // The service SELECT includes AND revoked_at IS NULL, so revoked peers return no row.
    db.query.mockResolvedValueOnce([[]]); // DB filters out the revoked row

    await expect(userTunnelService.rotatePeer(10, 1, 99))
      .rejects
      .toThrow('wg_user_peers not found');
  });

  test('audit log is written without any key material', async () => {
    setupRotateDbMocks();

    await userTunnelService.rotatePeer(10, 1, 99);

    expect(auditLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        tableName: 'wg_user_peers',
        recordId: 10,
        newValues: expect.objectContaining({ rotated: true, new_public_key: 'NEWPUBKEY==' }),
      }),
    );
    // Audit payload must NOT include the private key
    const auditPayload = auditLog.log.mock.calls[0][0];
    const payloadStr = JSON.stringify(auditPayload);
    expect(payloadStr).not.toContain('NEWPRIVKEY==');
    expect(payloadStr).not.toContain('encrypted-ciphertext');
  });
});

// =============================================================================
// refreshAffectedByNas()
// =============================================================================
describe('refreshAffectedByNas()', () => {
  test('exits early without error when NAS is not found (or soft-deleted)', async () => {
    db.query.mockResolvedValueOnce([[]]); // nas not found

    await expect(userTunnelService.refreshAffectedByNas(999)).resolves.toBeUndefined();
    // No peer refresh should happen
    expect(wireguardServerService.setUserForwardScope).not.toHaveBeenCalled();
  });

  test('calls setUserForwardScope for each affected user\'s live peers', async () => {
    db.query
      // 1. NAS org lookup
      .mockResolvedValueOnce([[{ organization_id: 1 }]])
      // 2. Users assigned to this NAS (via site or NAS scope)
      .mockResolvedValueOnce([[{ user_id: 10 }]])
      // 3. Admin/owner users in the org
      .mockResolvedValueOnce([[{ user_id: 99 }]])
      // refreshUserPeers(10):
      //   4. user lookup
      .mockResolvedValueOnce([[{ id: 10, organization_id: 1, role: 'technician' }]])
      //   5. peer lookup
      .mockResolvedValueOnce([[{ id: 100, tunnel_address: '10.99.0.10' }]])
      //   6. UPDATE allowed_ips_snapshot for peer 100
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      // refreshUserPeers(99):
      //   7. user lookup
      .mockResolvedValueOnce([[{ id: 99, organization_id: 1, role: 'admin' }]])
      //   8. peer lookup
      .mockResolvedValueOnce([[{ id: 200, tunnel_address: '10.99.0.20' }]])
      //   9. UPDATE allowed_ips_snapshot for peer 200
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.5.0/24']);

    await userTunnelService.refreshAffectedByNas(5);

    // Two users → two setUserForwardScope calls (one per user's peer)
    expect(wireguardServerService.setUserForwardScope).toHaveBeenCalledTimes(2);
    expect(wireguardServerService.setUserForwardScope).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: 100, tunnelIp: '10.99.0.10', subnets: ['192.168.5.0/24'] }),
    );
    expect(wireguardServerService.setUserForwardScope).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: 200, tunnelIp: '10.99.0.20', subnets: ['192.168.5.0/24'] }),
    );
  });

  test('deduplicates users who appear in both assigned and admin sets', async () => {
    db.query
      .mockResolvedValueOnce([[{ organization_id: 1 }]])
      .mockResolvedValueOnce([[{ user_id: 99 }]])  // also an assigned user
      .mockResolvedValueOnce([[{ user_id: 99 }]])  // same user in admin query
      // refreshUserPeers(99) — called only once due to Set deduplication:
      .mockResolvedValueOnce([[{ id: 99, organization_id: 1, role: 'admin' }]])
      .mockResolvedValueOnce([[{ id: 200, tunnel_address: '10.99.0.20' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['10.0.0.0/8']);

    await userTunnelService.refreshAffectedByNas(5);

    // Only one setUserForwardScope call because user 99 is de-duped
    expect(wireguardServerService.setUserForwardScope).toHaveBeenCalledTimes(1);
  });

  test('is non-fatal when a single user\'s refresh fails; others still refreshed', async () => {
    db.query
      .mockResolvedValueOnce([[{ organization_id: 1 }]])
      .mockResolvedValueOnce([[{ user_id: 10 }, { user_id: 20 }]])
      .mockResolvedValueOnce([[]])
      // refreshUserPeers(10) — DB throws for this user's lookup
      .mockRejectedValueOnce(new Error('DB connection lost'))
      // refreshUserPeers(20) — succeeds:
      .mockResolvedValueOnce([[{ id: 20, organization_id: 1, role: 'technician' }]])
      .mockResolvedValueOnce([[{ id: 300, tunnel_address: '10.99.0.30' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['172.16.0.0/12']);

    // Must resolve (not reject) — the per-user error is swallowed, other users proceed
    await expect(userTunnelService.refreshAffectedByNas(5)).resolves.toBeUndefined();
    // User 20's peer was still synced despite user 10's failure
    expect(wireguardServerService.setUserForwardScope).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: 300, tunnelIp: '10.99.0.30' }),
    );
  });

  test('updates allowed_ips_snapshot in DB after recomputing scope', async () => {
    db.query
      .mockResolvedValueOnce([[{ organization_id: 1 }]])
      .mockResolvedValueOnce([[{ user_id: 10 }]])
      .mockResolvedValueOnce([[]])
      // refreshUserPeers(10):
      .mockResolvedValueOnce([[{ id: 10, organization_id: 1, role: 'technician' }]])
      .mockResolvedValueOnce([[{ id: 100, tunnel_address: '10.99.0.10' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // snapshot UPDATE

    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['10.5.0.0/16']);

    await userTunnelService.refreshAffectedByNas(5);

    // Verify the snapshot UPDATE query was called with the correct subnets JSON
    const updateCall = db.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('allowed_ips_snapshot'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1][0]).toBe(JSON.stringify(['10.5.0.0/16']));
  });

  test('does not call setUserForwardScope for users with no live peers', async () => {
    db.query
      .mockResolvedValueOnce([[{ organization_id: 1 }]])
      .mockResolvedValueOnce([[{ user_id: 10 }]])
      .mockResolvedValueOnce([[]])
      // refreshUserPeers(10):
      .mockResolvedValueOnce([[{ id: 10, organization_id: 1, role: 'technician' }]])
      .mockResolvedValueOnce([[]]); // no live peers

    userTunnelScopeService.getScopedSubnets.mockResolvedValue(['192.168.0.0/24']);

    await userTunnelService.refreshAffectedByNas(5);

    // No peers to refresh → setUserForwardScope should not be called
    expect(wireguardServerService.setUserForwardScope).not.toHaveBeenCalled();
  });
});
