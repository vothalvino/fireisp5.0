// =============================================================================
// FireISP 5.0 — WireGuard Server Service Tests — Part 2: user peer management
// =============================================================================
// Covers: allocateUserTunnelIp, syncUserPeer, readPeerHandshakes,
//         ensureBaseFirewall, setUserForwardScope, removeUserPeer
// All child_process.execFile calls are mocked; no live system required.
// =============================================================================

'use strict';

// ─── Mocks (hoisted by Jest before any require) ───────────────────────────────

jest.mock('child_process', () => ({ execFile: jest.fn() }));

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

jest.mock('os', () => ({ tmpdir: () => '/tmp' }));

jest.mock('../src/config/database', () => ({ query: jest.fn() }));

jest.mock('../src/config', () => ({
  wireguard: {
    serverEnabled: true,
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

jest.mock('../src/utils/logger', () => ({
  child: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

// ─── Requires (after mocks) ──────────────────────────────────────────────────

const { execFile } = require('child_process');
const db = require('../src/config/database');
const config = require('../src/config');
const { ValidationError } = require('../src/utils/errors');
const service = require('../src/services/wireguardServerService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Make the next execFile call succeed with the given stdout. */
function okOnce(stdout = '') {
  execFile.mockImplementationOnce((_c, _a, _o, cb) => cb(null, { stdout, stderr: '' }));
}

/** Make the next execFile call fail (simulates non-zero exit, e.g. "not found"). */
function failOnce(message = 'command failed') {
  execFile.mockImplementationOnce((_c, _a, _o, cb) => cb(new Error(message)));
}

/** Default: all execFile calls succeed with empty stdout. */
function mockAllOk() {
  execFile.mockImplementation((_c, _a, _o, cb) => cb(null, { stdout: '', stderr: '' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  config.wireguard.serverEnabled = true;
  config.wireguard.clientSubnet = '10.99.0.0/16';
  mockAllOk();
});

// =============================================================================
// allocateUserTunnelIp()
// =============================================================================

describe('allocateUserTunnelIp()', () => {
  test('returns the first host address in clientSubnet when pool is empty', async () => {
    db.query.mockResolvedValueOnce([[]]); // no existing user peers
    const ip = await service.allocateUserTunnelIp();
    // 10.99.0.0/16 → 10.99.0.1 is reserved for the wg-clients server interface,
    // so the first peer address is 10.99.0.2
    expect(ip).toBe('10.99.0.2');
  });

  test('skips already-used addresses and returns the lowest free one', async () => {
    db.query.mockResolvedValueOnce([[
      { tunnel_address: '10.99.0.1' },
      { tunnel_address: '10.99.0.2' },
      { tunnel_address: '10.99.0.5' }, // gap: 10.99.0.3 is free
    ]]);
    const ip = await service.allocateUserTunnelIp();
    expect(ip).toBe('10.99.0.3');
  });

  test('throws ValidationError when the pool is exhausted', async () => {
    // /30 has only 2 usable hosts (.1 and .2)
    config.wireguard.clientSubnet = '10.99.0.0/30';
    db.query.mockResolvedValueOnce([[
      { tunnel_address: '10.99.0.1' },
      { tunnel_address: '10.99.0.2' },
    ]]);
    await expect(service.allocateUserTunnelIp()).rejects.toThrow(ValidationError);
  });

  test('queries wg_user_peers with deleted_at IS NULL', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await service.allocateUserTunnelIp();
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/wg_user_peers/);
    expect(sql).toMatch(/deleted_at IS NULL/);
  });
});

// =============================================================================
// syncUserPeer() — user peer on wg-clients
// =============================================================================

describe('syncUserPeer()', () => {
  const PUB = 'dXNlclB1YmxpY0tleUJhc2U2NEVuY29kZWRBQUE=';
  const IP  = '10.99.0.7';

  test('calls wg set wg-clients with peer and allowed-ips /32 (no PSK)', async () => {
    const result = await service.syncUserPeer({ publicKey: PUB, tunnelIp: IP });

    expect(result).toEqual({ applied: true });
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(
      'wg',
      ['set', 'wg-clients', 'peer', PUB, 'allowed-ips', `${IP}/32`],
      { encoding: 'utf8' },
      expect.any(Function),
    );
  });

  test('passes PSK via temp keyfile argument, not directly in argv', async () => {
    const PSK = 'sHpV+TESTPRESHAREDKEY64BASE64ENCODED+exAmple=';
    await service.syncUserPeer({ publicKey: PUB, tunnelIp: IP, presharedKey: PSK });

    expect(execFile).toHaveBeenCalledTimes(1);
    const [, argv] = execFile.mock.calls[0];

    // preshared-key flag must appear
    expect(argv).toContain('preshared-key');

    // The argument after preshared-key must be a file path (temp file), not the PSK itself
    const pskFlagIdx = argv.indexOf('preshared-key');
    const pskArg = argv[pskFlagIdx + 1];
    expect(pskArg).toContain('fireisp-wg-'); // temp file name pattern
    expect(pskArg).not.toBe(PSK);

    // allowed-ips must still be the /32
    expect(argv).toContain('allowed-ips');
    expect(argv).toContain(`${IP}/32`);
  });

  test('cleans up the PSK temp file after wg set call', async () => {
    const { unlinkSync } = require('fs');
    await service.syncUserPeer({
      publicKey: PUB,
      tunnelIp: IP,
      presharedKey: 'TEST_PSK_VALUE',
    });
    expect(unlinkSync).toHaveBeenCalledTimes(1);
  });

  test('uses wg-clients interface name from config', async () => {
    await service.syncUserPeer({ publicKey: PUB, tunnelIp: IP });
    const [, argv] = execFile.mock.calls[0];
    expect(argv[1]).toBe('wg-clients');
  });

  test('returns NOOP result and never calls execFile when serverEnabled=false', async () => {
    config.wireguard.serverEnabled = false;
    const result = await service.syncUserPeer({ publicKey: PUB, tunnelIp: IP });

    expect(result).toMatchObject({ applied: false });
    expect(result.reason).toBeTruthy();
    expect(execFile).not.toHaveBeenCalled();
  });
});

// =============================================================================
// readPeerHandshakes()
// =============================================================================

describe('readPeerHandshakes()', () => {
  const IFACE = 'wg-clients';
  const PEER1 = 'UGVlcjFQdWJsaWNLZXlCYXNlNjQ=';
  const PEER2 = 'UGVlcjJQdWJsaWNLZXlCYXNlNjQ=';

  // wg show dump tab-separated columns (peer lines):
  // pubkey | preshared-key | endpoint | allowed-ips | latest-handshake | rx-bytes | tx-bytes | keepalive
  function buildDump(...peerLines) {
    const ifaceLine = `iface-priv\tiface-pub\t51821\toff`;
    return [ifaceLine, ...peerLines].join('\n');
  }

  test('calls wg show <iface> dump', async () => {
    okOnce(buildDump(`${PEER1}\t(none)\t1.2.3.4:51821\t10.99.0.1/32\t0\t0\t0\toff`));
    await service.readPeerHandshakes(IFACE);
    expect(execFile).toHaveBeenCalledWith(
      'wg', ['show', IFACE, 'dump'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('parses lastHandshakeUnix, rxBytes, txBytes, endpoint from peer lines', async () => {
    okOnce(buildDump(
      `${PEER1}\t(none)\t1.2.3.4:51821\t10.99.0.1/32\t1700000000\t1024\t2048\t25`,
    ));
    const result = await service.readPeerHandshakes(IFACE);

    expect(result[PEER1]).toEqual({
      lastHandshakeUnix: 1700000000,
      rxBytes: 1024,
      txBytes: 2048,
      endpoint: '1.2.3.4:51821',
    });
  });

  test('maps (none) endpoint to null', async () => {
    okOnce(buildDump(
      `${PEER1}\t(none)\t(none)\t10.99.0.1/32\t0\t0\t0\toff`,
    ));
    const result = await service.readPeerHandshakes(IFACE);
    expect(result[PEER1].endpoint).toBeNull();
  });

  test('parses multiple peers correctly and skips the interface line', async () => {
    okOnce(buildDump(
      `${PEER1}\t(none)\t1.2.3.4:51821\t10.99.0.1/32\t1700000001\t100\t200\t25`,
      `${PEER2}\t(none)\t5.6.7.8:51821\t10.99.0.2/32\t1700000002\t300\t400\t25`,
    ));
    const result = await service.readPeerHandshakes(IFACE);

    expect(Object.keys(result)).toHaveLength(2);
    expect(result[PEER1].lastHandshakeUnix).toBe(1700000001);
    expect(result[PEER2].lastHandshakeUnix).toBe(1700000002);
    // Interface line (priv key) must NOT appear as a key
    expect(result['iface-priv']).toBeUndefined();
  });

  test('returns zero-valued numeric fields when handshake timestamp is 0', async () => {
    okOnce(buildDump(
      `${PEER1}\t(none)\t1.2.3.4:51821\t10.99.0.1/32\t0\t0\t0\toff`,
    ));
    const result = await service.readPeerHandshakes(IFACE);
    expect(result[PEER1].lastHandshakeUnix).toBe(0);
    expect(result[PEER1].rxBytes).toBe(0);
    expect(result[PEER1].txBytes).toBe(0);
  });

  test('returns empty object when serverEnabled=false (no execFile call)', async () => {
    config.wireguard.serverEnabled = false;
    const result = await service.readPeerHandshakes(IFACE);
    expect(result).toEqual({});
    expect(execFile).not.toHaveBeenCalled();
  });

  test('returns empty object on execFile error (graceful degradation)', async () => {
    failOnce('wg: interface not found');
    const result = await service.readPeerHandshakes(IFACE);
    expect(result).toEqual({});
  });
});

// =============================================================================
// ensureBaseFirewall()
// =============================================================================

describe('ensureBaseFirewall()', () => {
  test('installs the nftables table via nft -f on first call', async () => {
    // First call is nft list table → table not found (non-zero exit)
    failOnce('table not found');
    // Second call is nft -f <tmpFile> → success
    okOnce();

    const result = await service.ensureBaseFirewall();

    expect(result).toEqual({ applied: true });
    expect(execFile).toHaveBeenCalledTimes(2);

    // First call: nft list table inet fireisp_wg
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'nft', ['list', 'table', 'inet', 'fireisp_wg'],
      expect.any(Object),
      expect.any(Function),
    );

    // Second call: nft -f <tmpFile>
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      'nft', ['-f', expect.stringContaining('fireisp-wg-')],
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('nft file content includes forward chain, lateral-drop, masquerade, and wg_user_fwd chain', async () => {
    const { writeFileSync } = require('fs');
    failOnce('table not found');
    okOnce();

    await service.ensureBaseFirewall();

    // writeFileSync is called with the nft script content
    expect(writeFileSync).toHaveBeenCalled();
    const [, nftContent] = writeFileSync.mock.calls[0];
    expect(nftContent).toMatch(/fireisp_wg/);
    expect(nftContent).toMatch(/wg-fireisp/);
    expect(nftContent).toMatch(/wg-clients/);
    expect(nftContent).toMatch(/masquerade/);
    expect(nftContent).toMatch(/wg_user_fwd/);
    // Lateral movement drop
    expect(nftContent).toMatch(/iifname "wg-clients".*oifname "wg-clients".*drop/s);
  });

  test('is idempotent — returns {applied:false} and skips nft -f when table already exists', async () => {
    // nft list table exits 0 → table already installed
    okOnce('table inet fireisp_wg {}');

    const result = await service.ensureBaseFirewall();

    expect(result).toMatchObject({ applied: false });
    expect(result.reason).toBeTruthy();
    // Only one execFile call (the existence check); no nft -f
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('returns NOOP result and never calls execFile when serverEnabled=false', async () => {
    config.wireguard.serverEnabled = false;
    const result = await service.ensureBaseFirewall();

    expect(result).toMatchObject({ applied: false });
    expect(execFile).not.toHaveBeenCalled();
  });
});

// =============================================================================
// setUserForwardScope()
// =============================================================================

describe('setUserForwardScope()', () => {
  const PEER_ID  = 7;
  const TUNNEL_IP = '10.99.0.7';
  const SUBNETS  = ['192.168.1.0/24', '192.168.2.0/24'];
  const SET_NAME = `u${PEER_ID}_dst`;

  test('creates named set, flushes/populates elements, adds accept rule when all are new', async () => {
    // 1: nft list set → set not found
    failOnce('set not found');
    // 2: nft -f (create set)
    okOnce();
    // 3: nft -f (atomic flush+add elements)
    okOnce();
    // 4: nft list chain → chain found, dump does NOT contain @u7_dst (rule absent)
    okOnce('chain inet fireisp_wg wg_user_fwd { }');
    // 5: nft -f (add rule)
    okOnce();

    const result = await service.setUserForwardScope({
      peerId: PEER_ID,
      tunnelIp: TUNNEL_IP,
      subnets: SUBNETS,
    });

    expect(result).toEqual({ applied: true });
    expect(execFile).toHaveBeenCalledTimes(5);
  });

  test('set creation script contains correct set name', async () => {
    const { writeFileSync } = require('fs');
    failOnce('set not found'); // set doesn't exist
    mockAllOk();               // remaining calls succeed

    await service.setUserForwardScope({ peerId: PEER_ID, tunnelIp: TUNNEL_IP, subnets: SUBNETS });

    // writeFileSync call[0] = create-set script
    const [, createContent] = writeFileSync.mock.calls[0];
    expect(createContent).toMatch(new RegExp(`add set inet fireisp_wg ${SET_NAME}`));
    expect(createContent).toMatch(/ipv4_addr/);
    expect(createContent).toMatch(/interval/);
  });

  test('atomic flush+add script contains the allowed subnets', async () => {
    const { writeFileSync } = require('fs');
    // Set already exists so no create call; then atomic flush, list chain, rule
    okOnce(); // nft list set → set exists
    okOnce(); // nft -f flush+add
    okOnce('chain inet fireisp_wg wg_user_fwd { }'); // list chain (no rule)
    okOnce(); // nft -f add rule

    await service.setUserForwardScope({ peerId: PEER_ID, tunnelIp: TUNNEL_IP, subnets: SUBNETS });

    // writeFileSync call[0] = atomic flush+add script
    const [, atomicContent] = writeFileSync.mock.calls[0];
    expect(atomicContent).toMatch(new RegExp(`flush set inet fireisp_wg ${SET_NAME}`));
    for (const subnet of SUBNETS) {
      expect(atomicContent).toContain(subnet);
    }
  });

  test('adds accept rule with correct tunnel IP source and set name', async () => {
    const { writeFileSync } = require('fs');
    okOnce();  // list set → exists
    okOnce();  // flush+add
    okOnce('chain inet fireisp_wg wg_user_fwd { }'); // list chain → no rule
    okOnce();  // add rule

    await service.setUserForwardScope({ peerId: PEER_ID, tunnelIp: TUNNEL_IP, subnets: SUBNETS });

    // Last writeFileSync call = the accept rule script
    const ruleCalls = require('fs').writeFileSync.mock.calls;
    const [, ruleContent] = ruleCalls[ruleCalls.length - 1];
    expect(ruleContent).toMatch(new RegExp(`ip saddr ${TUNNEL_IP}`));
    expect(ruleContent).toMatch(new RegExp(`@${SET_NAME}`));
    expect(ruleContent).toMatch(/accept/);
  });

  test('skips rule creation when it is already present in the chain dump', async () => {
    okOnce(); // list set → exists
    okOnce(); // flush+add
    // Chain dump already contains the set name reference
    okOnce(`chain inet fireisp_wg wg_user_fwd { rule ... @${SET_NAME} ... }`);
    // No 4th call expected

    const result = await service.setUserForwardScope({
      peerId: PEER_ID,
      tunnelIp: TUNNEL_IP,
      subnets: SUBNETS,
    });

    expect(result).toEqual({ applied: true });
    expect(execFile).toHaveBeenCalledTimes(3);
  });

  test('returns early with applied:false when the wg_user_fwd chain is not found', async () => {
    okOnce(); // list set → exists
    okOnce(); // flush+add
    failOnce('chain not found'); // list chain → error

    const result = await service.setUserForwardScope({
      peerId: PEER_ID,
      tunnelIp: TUNNEL_IP,
      subnets: SUBNETS,
    });

    expect(result).toMatchObject({ applied: false });
    expect(result.reason).toMatch(/ensureBaseFirewall/);
  });

  test('works with an empty subnets array (tunnel stays up, no forwarding)', async () => {
    failOnce('set not found'); // set doesn't exist
    okOnce(); // create set
    okOnce(); // flush (no add — empty subnets)
    okOnce('chain inet fireisp_wg wg_user_fwd { }'); // list chain
    okOnce(); // add rule

    const result = await service.setUserForwardScope({
      peerId: PEER_ID,
      tunnelIp: TUNNEL_IP,
      subnets: [],
    });

    expect(result).toEqual({ applied: true });
  });

  test('returns NOOP result and never calls execFile when serverEnabled=false', async () => {
    config.wireguard.serverEnabled = false;
    const result = await service.setUserForwardScope({
      peerId: PEER_ID,
      tunnelIp: TUNNEL_IP,
      subnets: SUBNETS,
    });

    expect(result).toMatchObject({ applied: false });
    expect(execFile).not.toHaveBeenCalled();
  });
});

// =============================================================================
// removeUserPeer()
// =============================================================================

describe('removeUserPeer()', () => {
  const PUB     = 'dXNlclB1YmxpY0tleVJlbW92ZUJhc2U2NA==';
  const PEER_ID = 12;
  const SET_NAME = `u${PEER_ID}_dst`;

  /** Build the nft JSON output for a chain containing one rule that references the set. */
  function nftChainJson() {
    return JSON.stringify({
      nftables: [
        {
          rule: {
            handle: 42,
            expr: [
              { match: { left: { payload: {} }, right: `@${SET_NAME}` } },
            ],
          },
        },
      ],
    });
  }

  test('calls wg set wg-clients peer remove', async () => {
    okOnce(); // wg set remove
    okOnce(nftChainJson()); // nft -j list chain
    okOnce(); // nft delete rule
    okOnce(); // nft -f (delete set)

    const result = await service.removeUserPeer({ publicKey: PUB, peerId: PEER_ID });

    expect(result).toEqual({ applied: true });
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'wg',
      ['set', 'wg-clients', 'peer', PUB, 'remove'],
      { encoding: 'utf8' },
      expect.any(Function),
    );
  });

  test('queries nft chain JSON to find the rule handle', async () => {
    okOnce(); // wg remove
    okOnce(nftChainJson()); // nft -j list chain
    okOnce(); // delete rule
    okOnce(); // delete set

    await service.removeUserPeer({ publicKey: PUB, peerId: PEER_ID });

    expect(execFile).toHaveBeenCalledWith(
      'nft',
      ['-j', 'list', 'chain', 'inet', 'fireisp_wg', 'wg_user_fwd'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('deletes the rule by handle found in JSON output', async () => {
    okOnce(); // wg remove
    okOnce(nftChainJson()); // nft -j → handle 42
    okOnce(); // delete rule
    okOnce(); // delete set

    await service.removeUserPeer({ publicKey: PUB, peerId: PEER_ID });

    expect(execFile).toHaveBeenCalledWith(
      'nft',
      ['delete', 'rule', 'inet', 'fireisp_wg', 'wg_user_fwd', 'handle', '42'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('deletes the named set via nft -f', async () => {
    okOnce(); // wg remove
    okOnce(nftChainJson()); // nft -j list chain
    okOnce(); // delete rule
    okOnce(); // delete set

    await service.removeUserPeer({ publicKey: PUB, peerId: PEER_ID });

    // Last nft -f call deletes the set
    const nftFCalls = execFile.mock.calls.filter(
      ([cmd, args]) => cmd === 'nft' && args[0] === '-f',
    );
    expect(nftFCalls.length).toBeGreaterThanOrEqual(1);

    // The set-delete script content
    const { writeFileSync } = require('fs');
    const setDelCall = writeFileSync.mock.calls.find(
      ([, content]) => typeof content === 'string' && content.includes(`delete set`),
    );
    expect(setDelCall).toBeDefined();
    const [, setDelContent] = setDelCall;
    expect(setDelContent).toContain(SET_NAME);
  });

  test('returns {applied:true} even when nft cleanup fails (best-effort)', async () => {
    okOnce();            // wg set remove
    failOnce('json parse failed'); // nft -j list chain → error

    const result = await service.removeUserPeer({ publicKey: PUB, peerId: PEER_ID });
    expect(result).toEqual({ applied: true });
  });

  test('returns NOOP result and never calls execFile when serverEnabled=false', async () => {
    config.wireguard.serverEnabled = false;
    const result = await service.removeUserPeer({ publicKey: PUB, peerId: PEER_ID });

    expect(result).toMatchObject({ applied: false });
    expect(execFile).not.toHaveBeenCalled();
  });
});
