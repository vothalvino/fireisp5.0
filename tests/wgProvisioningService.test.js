// =============================================================================
// FireISP 5.0 — WireGuard Provisioning Service Tests
// =============================================================================
// Covers wgProvisioningService (Part 1 — per-NAS tunnels):
//
//   provisionDesiredState — idempotency: re-provision reuses existing
//                           keypair + tunnel IP; new tunnel generates keys
//                           + allocates IP + calls syncPeer.
//   bootstrap             — API-success → state='active' + syncPeer called;
//                           routerUnreachable → { method:'snippet' },
//                           state='manual', no throw;
//                           routerAuthFailed → propagates (route maps to 422).
//   discoverSubnets       — WAN and WireGuard server subnet exclusion.
//
// wireguardServerService and routerosService are fully mocked so no
// shell-outs, execFile calls, or real RouterOS connections occur.
// =============================================================================

'use strict';

// ---------------------------------------------------------------------------
// Module mocks — must precede all require() calls
// ---------------------------------------------------------------------------

jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    fatal: jest.fn(),
  }),
}));

jest.mock('../src/config/database', () => ({
  query: jest.fn(),
  execute: jest.fn(),
  getConnection: jest.fn(),
  close: jest.fn(),
  pool: { end: jest.fn() },
}));

// Hub service: mock every shell-out function
jest.mock('../src/services/wireguardServerService');

// RouterOS API service: mock every router-protocol function
jest.mock('../src/services/routerosService');

// routerProvisioningService: only nasToConn is used from the SUT
jest.mock('../src/services/routerProvisioningService');

// Encryption: stable passthrough factory — never exercise actual AES here
jest.mock('../src/utils/encryption');

// NasWgTunnel model: only the static create method is called from the SUT
jest.mock('../src/models/NasWgTunnel', () => ({ create: jest.fn() }));

// ---------------------------------------------------------------------------
// Requires — after all jest.mock declarations
// ---------------------------------------------------------------------------

const db = require('../src/config/database');
const wg = require('../src/services/wireguardServerService');
const ros = require('../src/services/routerosService');
const { nasToConn } = require('../src/services/routerProvisioningService');
const { encrypt, decrypt } = require('../src/utils/encryption');
const NasWgTunnel = require('../src/models/NasWgTunnel');

const {
  provisionDesiredState,
  bootstrap,
  discoverSubnets,
} = require('../src/services/wgProvisioningService');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Base NAS row (ip_address drives the WAN-exclusion tests in discoverSubnets). */
const BASE_NAS = {
  id: 7,
  organization_id: 1,
  name: 'Core-RB',
  ip_address: '192.168.1.1',
  api_username: 'fireisp',
  api_password_encrypted: 'enc:apipass',
  api_port: 8728,
  api_use_tls: 0,
};

/** Fully-populated tunnel row as returned by loadTunnel (db.query SELECT). */
const MOCK_TUNNEL = {
  id: 42,
  organization_id: 1,
  nas_id: 7,
  interface_name: 'fireisp-nas-7',
  tunnel_address: '10.255.0.1',
  nas_public_key: 'pubkey==',
  nas_private_key_encrypted: 'enc:privkey',
  nas_config_method: 'manual',
  routed_subnets: '[]',
  state: 'pending',
  server_peer_synced: 0,
};

/** Connection descriptor returned by the mocked nasToConn. */
const MOCK_CONN = { host: '192.168.1.1', port: 8728, user: 'fireisp' };

// ---------------------------------------------------------------------------
// Global per-test reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();

  // encryption: stable bijection — never expose plaintext AES internals
  encrypt.mockImplementation((v) => `enc:${v}`);
  decrypt.mockImplementation((v) => (typeof v === 'string' ? v.replace(/^enc:/, '') : ''));

  // wireguardServerService defaults (serverEnabled=true path)
  wg.generateKeypair.mockReturnValue({ privateKey: 'privkey', publicKey: 'pubkey==' });
  wg.allocateTunnelIp.mockResolvedValue('10.255.0.1');
  wg.syncPeer.mockResolvedValue({ applied: true });

  // routerProvisioningService
  nasToConn.mockReturnValue(MOCK_CONN);

  // NasWgTunnel.create returns the canonical mock tunnel
  NasWgTunnel.create.mockResolvedValue({ ...MOCK_TUNNEL });
});

// =============================================================================
// §9 — provisionDesiredState: re-provision reuses existing IP + keys
// =============================================================================

describe('provisionDesiredState — idempotent re-provision', () => {
  test('reuses existing public key and tunnel IP when a live tunnel record already exists', async () => {
    // loadTunnel finds existing record; UPDATE server_peer_synced follows
    db.query
      .mockResolvedValueOnce([[MOCK_TUNNEL]])        // SELECT nas_wg_tunnels → exists
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE server_peer_synced

    const result = await provisionDesiredState(BASE_NAS);

    // Keypair generation and IP allocation must NOT run for an existing tunnel
    expect(wg.generateKeypair).not.toHaveBeenCalled();
    expect(wg.allocateTunnelIp).not.toHaveBeenCalled();
    expect(NasWgTunnel.create).not.toHaveBeenCalled();

    // syncPeer IS called — idempotent host-side peer re-sync still happens
    expect(wg.syncPeer).toHaveBeenCalledTimes(1);
    expect(wg.syncPeer).toHaveBeenCalledWith(expect.objectContaining({
      publicKey: MOCK_TUNNEL.nas_public_key,
      tunnelIp: MOCK_TUNNEL.tunnel_address,
    }));

    // Step log must report 'exists', not 'created'
    const keypairStep = result.steps.find((s) => s.step === 'keypair');
    expect(keypairStep).toBeDefined();
    expect(keypairStep.status).toBe('exists');
    expect(result.tunnel).toBeDefined();
  });

  test('generates a fresh keypair and allocates a new IP when no tunnel exists', async () => {
    // loadTunnel returns no rows; UPDATE server_peer_synced follows after creation
    db.query
      .mockResolvedValueOnce([[]])                   // SELECT → no tunnel found
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE server_peer_synced

    const result = await provisionDesiredState(BASE_NAS);

    // All three creation steps must fire exactly once
    expect(wg.generateKeypair).toHaveBeenCalledTimes(1);
    expect(wg.allocateTunnelIp).toHaveBeenCalledTimes(1);
    expect(NasWgTunnel.create).toHaveBeenCalledTimes(1);

    // NasWgTunnel.create receives correctly assembled data
    const createArg = NasWgTunnel.create.mock.calls[0][0];
    expect(createArg.nas_public_key).toBe('pubkey==');
    expect(createArg.tunnel_address).toBe('10.255.0.1');
    expect(createArg.state).toBe('pending');
    // Private key was encrypted before storage (never stored in plaintext)
    expect(encrypt).toHaveBeenCalledWith('privkey');

    // syncPeer is still called — host-side peer seeded immediately
    expect(wg.syncPeer).toHaveBeenCalledTimes(1);

    const keypairStep = result.steps.find((s) => s.step === 'keypair');
    expect(keypairStep).toBeDefined();
    expect(keypairStep.status).toBe('created');
  });
});

// =============================================================================
// §9 — bootstrap: API success → state='active' + syncPeer
// =============================================================================

describe('bootstrap — API success', () => {
  test('returns method=api and state=active when all RouterOS writes succeed (no pre-existing tunnel)', async () => {
    // Sequence: loadTunnel×2 (bootstrap + provisionDesiredState), UPDATE
    // server_peer_synced, UPDATE state=active
    db.query
      .mockResolvedValueOnce([[]])                   // loadTunnel in bootstrap → no tunnel
      .mockResolvedValueOnce([[]])                   // loadTunnel in provisionDesiredState
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // UPDATE server_peer_synced
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE nas_config_method=api, state=active

    ros.wireguardInterfaceUpsert.mockResolvedValue({ created: true });
    ros.wireguardAddressUpsert.mockResolvedValue({ created: true });
    ros.wireguardPeerUpsert.mockResolvedValue({ created: true });

    const result = await bootstrap(BASE_NAS);

    expect(result.method).toBe('api');
    expect(result.tunnel).toBeDefined();
    expect(result.tunnel.state).toBe('active');
    expect(result.tunnel.nas_config_method).toBe('api');

    // syncPeer fired during the provisionDesiredState sub-call
    expect(wg.syncPeer).toHaveBeenCalledTimes(1);

    // All three RouterOS writes executed in the correct order
    expect(ros.wireguardInterfaceUpsert).toHaveBeenCalledTimes(1);
    expect(ros.wireguardAddressUpsert).toHaveBeenCalledTimes(1);
    expect(ros.wireguardPeerUpsert).toHaveBeenCalledTimes(1);
  });

  test('step list contains interface, address, peer, and state steps on success (pre-existing tunnel)', async () => {
    // Tunnel already exists — provisionDesiredState is bypassed inside bootstrap
    db.query
      .mockResolvedValueOnce([[MOCK_TUNNEL]])        // loadTunnel → tunnel exists
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE state=active

    ros.wireguardInterfaceUpsert.mockResolvedValue({ created: false });
    ros.wireguardAddressUpsert.mockResolvedValue({ created: false });
    ros.wireguardPeerUpsert.mockResolvedValue({ created: false });

    const result = await bootstrap(BASE_NAS);

    const stepNames = result.steps.map((s) => s.step);
    expect(stepNames).toContain('interface');
    expect(stepNames).toContain('address');
    expect(stepNames).toContain('peer');
    expect(stepNames).toContain('state');
  });

  test('passes the tunnel interface name and decrypted private key to each RouterOS write', async () => {
    db.query
      .mockResolvedValueOnce([[MOCK_TUNNEL]])        // loadTunnel → tunnel exists
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE state=active

    ros.wireguardInterfaceUpsert.mockResolvedValue({ created: true });
    ros.wireguardAddressUpsert.mockResolvedValue({ created: true });
    ros.wireguardPeerUpsert.mockResolvedValue({ created: true });

    await bootstrap(BASE_NAS);

    // Interface write receives the exact interface name and decrypted private key
    expect(ros.wireguardInterfaceUpsert).toHaveBeenCalledWith(
      MOCK_CONN,
      expect.objectContaining({
        name: MOCK_TUNNEL.interface_name,
        privateKey: 'privkey',      // decrypt('enc:privkey') → 'privkey'
      }),
    );

    // Address write receives tunnelIp/32 (no prefix stored in DB, added here)
    expect(ros.wireguardAddressUpsert).toHaveBeenCalledWith(
      MOCK_CONN,
      expect.objectContaining({
        interface: MOCK_TUNNEL.interface_name,
        address: `${MOCK_TUNNEL.tunnel_address}/32`,
      }),
    );

    // Peer write uses the stable comment so key rotation stays idempotent
    expect(ros.wireguardPeerUpsert).toHaveBeenCalledWith(
      MOCK_CONN,
      expect.objectContaining({
        interface: MOCK_TUNNEL.interface_name,
        comment: 'fireisp-server',
      }),
    );
  });
});

// =============================================================================
// §9 — bootstrap: routerUnreachable → {method:'snippet'}, state='manual', no throw
// =============================================================================

describe('bootstrap — router unreachable', () => {
  /** Create a fresh error each time (Jest clears mock state but not object refs). */
  function makeUnreachErr() {
    return Object.assign(new Error('connect ETIMEDOUT 192.168.1.1:8728'), {
      routerUnreachable: true,
    });
  }

  function setupUnreachable() {
    db.query
      .mockResolvedValueOnce([[MOCK_TUNNEL]])        // loadTunnel → tunnel exists
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE state=manual
    ros.wireguardInterfaceUpsert.mockRejectedValue(makeUnreachErr());
  }

  test('resolves (does NOT throw) and returns method=snippet', async () => {
    setupUnreachable();

    // If this line rejects the test fails — that is the "no throw" assertion
    const data = await bootstrap(BASE_NAS);

    expect(data.method).toBe('snippet');
    expect(typeof data.snippet).toBe('string');
    expect(data.snippet.length).toBeGreaterThan(0);
  });

  test('snippet is WG-only — no /ip/service, /ip/firewall, or Winbox command lines', async () => {
    setupUnreachable();

    const { snippet } = await bootstrap(BASE_NAS);

    // Strip comment lines (they may reference these paths in "NOT touched" notes)
    // and assert that no actual RouterOS command writes to forbidden paths.
    const commandLines = snippet
      .split('\n')
      .filter((l) => !l.trim().startsWith('#') && l.trim().length > 0)
      .join('\n');

    expect(commandLines).not.toMatch(/\/ip\/service/);
    expect(commandLines).not.toMatch(/\/ip\/firewall/);
    expect(commandLines).not.toMatch(/winbox/i);
    // Port 8291 (Winbox) must never appear in a command — hard constraint
    expect(commandLines).not.toMatch(/8291/);
  });

  test('snippet contains the three allowed WG write paths', async () => {
    setupUnreachable();

    const { snippet } = await bootstrap(BASE_NAS);

    expect(snippet).toMatch(/\/interface\/wireguard/);
    expect(snippet).toMatch(/\/ip\/address/);
    expect(snippet).toMatch(/\/interface\/wireguard\/peers/);
  });

  test('persists nas_config_method=snippet and state=manual in the DB', async () => {
    setupUnreachable();

    await bootstrap(BASE_NAS);

    // The UPDATE for snippet mode must include both 'snippet' and 'manual'
    const updateCall = db.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && /UPDATE.*nas_wg_tunnels/.test(sql),
    );
    expect(updateCall).toBeDefined();
    const params = updateCall[1]; // the bind-parameter array
    expect(params).toContain('snippet');
    expect(params).toContain('manual');
  });

  test('includes a reachability step with status=unreachable in the step list', async () => {
    setupUnreachable();

    const { steps } = await bootstrap(BASE_NAS);

    const reachStep = steps.find((s) => s.step === 'reachability');
    expect(reachStep).toBeDefined();
    expect(reachStep.status).toBe('unreachable');
  });
});

// =============================================================================
// §9 — bootstrap: routerAuthFailed → propagates (route layer returns 422)
// =============================================================================

describe('bootstrap — router auth failure', () => {
  function makeAuthErr() {
    return Object.assign(
      new Error('RouterOS login failed: invalid user name or password (6)'),
      { routerAuthFailed: true },
    );
  }

  test('propagates the error so the route layer can return 422', async () => {
    db.query.mockResolvedValueOnce([[MOCK_TUNNEL]]); // loadTunnel only

    ros.wireguardInterfaceUpsert.mockRejectedValue(makeAuthErr());

    await expect(bootstrap(BASE_NAS)).rejects.toMatchObject({
      routerAuthFailed: true,
    });
  });

  test('does NOT update the DB on auth failure — exactly one db.query call', async () => {
    db.query.mockResolvedValueOnce([[MOCK_TUNNEL]]); // loadTunnel only

    ros.wireguardInterfaceUpsert.mockRejectedValue(makeAuthErr());

    await expect(bootstrap(BASE_NAS)).rejects.toThrow('invalid user name or password');

    // Only the loadTunnel SELECT was called — no UPDATE to state=manual/snippet
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('rejects with the original error message (preserves diagnostic info)', async () => {
    db.query.mockResolvedValueOnce([[MOCK_TUNNEL]]);

    ros.wireguardInterfaceUpsert.mockRejectedValue(makeAuthErr());

    await expect(bootstrap(BASE_NAS)).rejects.toThrow('RouterOS login failed');
  });
});

// =============================================================================
// §9 — discoverSubnets: WAN and WG server subnet exclusion
// =============================================================================

describe('discoverSubnets — subnet exclusion filter', () => {
  /** NAS whose WAN management IP (192.168.1.1) lives in 192.168.1.0/24. */
  const WG_NAS = { ...BASE_NAS, ip_address: '192.168.1.1' };

  /**
   * Build a topology mock from an array of dst-address strings and set up the
   * ros.wireguardReadTopology return value for the current test.
   */
  function mockTopology(dstAddresses) {
    ros.wireguardReadTopology.mockResolvedValue({
      routes: dstAddresses.map((r) => ({ 'dst-address': r })),
      addresses: [],
      interfaces: [],
    });
  }

  test('excludes a route that is a sub-prefix of the WireGuard server subnet', async () => {
    // 10.255.0.0/24 is a /24 subset of WG_SERVER_SUBNET 10.255.0.0/16 — must be excluded
    mockTopology(['10.255.0.0/24', '10.0.0.0/24']);

    const { proposed } = await discoverSubnets(WG_NAS);

    expect(proposed).not.toContain('10.255.0.0/24');
    expect(proposed).toContain('10.0.0.0/24');
  });

  test('excludes a route that is a super-prefix of the WireGuard server subnet', async () => {
    // 10.0.0.0/8 overlaps 10.255.0.0/16 at the shorter /8 prefix — excluded
    mockTopology(['10.0.0.0/8', '172.16.0.0/24']);

    const { proposed } = await discoverSubnets(WG_NAS);

    expect(proposed).not.toContain('10.0.0.0/8');
    expect(proposed).toContain('172.16.0.0/24');
  });

  test('excludes the subnet that contains the NAS WAN/management IP', async () => {
    // NAS IP 192.168.1.1 falls inside 192.168.1.0/24 — that route is excluded
    mockTopology(['192.168.1.0/24', '172.16.0.0/24']);

    const { proposed } = await discoverSubnets(WG_NAS);

    expect(proposed).not.toContain('192.168.1.0/24');
    expect(proposed).toContain('172.16.0.0/24');
  });

  test('excludes both WG subnet overlap and WAN subnet in a single topology scan', async () => {
    mockTopology([
      '10.255.0.0/24',    // WG subnet overlap
      '192.168.1.0/24',  // NAS WAN subnet
      '10.0.0.0/24',     // valid customer LAN
      '172.16.0.0/24',   // valid customer LAN
    ]);

    const { proposed } = await discoverSubnets(WG_NAS);

    expect(proposed).toHaveLength(2);
    expect(proposed).toContain('10.0.0.0/24');
    expect(proposed).toContain('172.16.0.0/24');
  });

  test('skips /32 and /128 host routes (e.g. a cloud router WAN gateway link-route)', async () => {
    // A cloud-hosted RouterOS (CHR) on a /32 WAN has a connected host-route to its
    // gateway (203.0.113.1/32). It is connected but is NOT a LAN behind the NAS —
    // it must never be proposed. /128 covers the IPv6 host-route equivalent.
    mockTopology([
      '203.0.113.1/32',  // WAN gateway link-route — host route, must be skipped
      'fd00::1/128',     // IPv6 host route — skipped
      '10.0.0.0/24',     // valid customer LAN
    ]);

    const { proposed } = await discoverSubnets(WG_NAS);

    expect(proposed).not.toContain('203.0.113.1/32');
    expect(proposed).not.toContain('fd00::1/128');
    expect(proposed).toEqual(['10.0.0.0/24']);
  });

  test('skips route entries that have no dst-address or no CIDR prefix', async () => {
    mockTopology([
      '',              // empty string
      '10.0.0.0',     // no slash → dropped by the prefix guard
      '10.0.0.0/24',  // valid
    ]);

    const { proposed } = await discoverSubnets(WG_NAS);

    expect(proposed).toEqual(['10.0.0.0/24']);
  });

  test('returns an empty proposed list when every route is excluded', async () => {
    mockTopology([
      '10.255.0.0/16',   // exact WG server subnet
      '192.168.1.0/24',  // NAS WAN
    ]);

    const { proposed } = await discoverSubnets(WG_NAS);

    expect(proposed).toEqual([]);
  });

  test('also returns the raw topology object alongside the proposed list', async () => {
    const rawTopology = {
      routes: [{ 'dst-address': '10.0.0.0/24' }],
      addresses: [{ address: '10.255.0.1/32' }],
      interfaces: [{ name: 'fireisp-nas-7' }],
    };
    ros.wireguardReadTopology.mockResolvedValue(rawTopology);

    const result = await discoverSubnets(WG_NAS);

    expect(result.topology).toEqual(rawTopology);
    expect(result.proposed).toBeDefined();
  });
});
