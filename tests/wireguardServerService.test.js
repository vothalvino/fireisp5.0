// =============================================================================
// FireISP 5.0 — WireGuard Server Service Tests — Part 1: NAS peer management
// =============================================================================
// Covers: generateKeypair, allocateTunnelIp, syncPeer, removePeer
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

const crypto = require('crypto');
const { execFile } = require('child_process');
const db = require('../src/config/database');
const config = require('../src/config');
const { ValidationError } = require('../src/utils/errors');
const service = require('../src/services/wireguardServerService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Configure execFile mock to succeed with the given stdout for the next call.
 * Subsequent calls also succeed unless reconfigured.
 */
function mockExecOk(stdout = '') {
  execFile.mockImplementation((_c, _a, _o, cb) => cb(null, { stdout, stderr: '' }));
}

/**
 * Configure execFile mock to fail with an error for the next call only.
 */
function mockExecFail(message = 'command failed') {
  execFile.mockImplementationOnce((_c, _a, _o, cb) => cb(new Error(message)));
}

// Restore serverEnabled and clear mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  config.wireguard.serverEnabled = true;
  config.wireguard.serverSubnet = '10.255.0.0/16';
  // Default success behaviour for all execFile calls
  mockExecOk();
});

// =============================================================================
// generateKeypair()
// =============================================================================

describe('generateKeypair()', () => {
  test('returns base64 strings of exactly 44 characters each', () => {
    const { privateKey, publicKey } = service.generateKeypair();
    expect(privateKey).toHaveLength(44);
    expect(publicKey).toHaveLength(44);
  });

  test('private key decodes to exactly 32 raw bytes', () => {
    const { privateKey } = service.generateKeypair();
    const raw = Buffer.from(privateKey, 'base64');
    expect(raw).toHaveLength(32);
  });

  test('public key decodes to exactly 32 raw bytes', () => {
    const { publicKey } = service.generateKeypair();
    const raw = Buffer.from(publicKey, 'base64');
    expect(raw).toHaveLength(32);
  });

  test('each call returns a different keypair', () => {
    const a = service.generateKeypair();
    const b = service.generateKeypair();
    // Overwhelmingly unlikely to collide with a real x25519 random key
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  test('public key is consistent with the private key (DER-slice math)', () => {
    // Validates the two offsets used in generateKeypair:
    //   PKCS8 DER (48 bytes): private key raw bytes start at byte 16
    //   SPKI DER  (44 bytes): public  key raw bytes start at byte 12
    //
    // We reconstruct the full PKCS8 from the sliced private key, import it via
    // Node crypto, derive the public key, and verify it matches the returned one.
    const { privateKey, publicKey } = service.generateKeypair();

    // PKCS8 DER header for x25519 (16 bytes):
    //   SEQUENCE(46) | INTEGER(0) | SEQUENCE(OID x25519) | OCTET-STRING(OCTET-STRING(32))
    const pkcs8Header = Buffer.from('302e020100300506032b656e04220420', 'hex');
    const privBytes = Buffer.from(privateKey, 'base64');
    const pkcs8Der = Buffer.concat([pkcs8Header, privBytes]);

    const privKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
    const pubKey = crypto.createPublicKey(privKey);
    const spkiDer = pubKey.export({ type: 'spki', format: 'der' });
    // SPKI DER for x25519 is always 44 bytes; raw key at offset 12
    const derivedPublicKey = spkiDer.slice(12).toString('base64');

    expect(publicKey).toBe(derivedPublicKey);
  });
});

// =============================================================================
// allocateTunnelIp()
// =============================================================================

describe('allocateTunnelIp()', () => {
  test('returns the first host address in serverSubnet when pool is empty', async () => {
    db.query.mockResolvedValueOnce([[]]); // no existing tunnels
    const ip = await service.allocateTunnelIp();
    // 10.255.0.0/16 → 10.255.0.1 is reserved for the wg-fireisp server interface,
    // so the first peer address is 10.255.0.2
    expect(ip).toBe('10.255.0.2');
  });

  test('skips already-used addresses and returns the lowest free one', async () => {
    db.query.mockResolvedValueOnce([[
      { tunnel_address: '10.255.0.1' },
      { tunnel_address: '10.255.0.2' },
      { tunnel_address: '10.255.0.4' }, // gap: 10.255.0.3 is free
    ]]);
    const ip = await service.allocateTunnelIp();
    expect(ip).toBe('10.255.0.3');
  });

  test('throws ValidationError when the pool is exhausted', async () => {
    // Shrink the subnet to /30 so there are only 2 usable hosts (.1 and .2)
    config.wireguard.serverSubnet = '10.255.0.0/30';
    db.query.mockResolvedValueOnce([[
      { tunnel_address: '10.255.0.1' },
      { tunnel_address: '10.255.0.2' },
    ]]);
    await expect(service.allocateTunnelIp()).rejects.toThrow(ValidationError);
  });

  test('queries only non-deleted tunnels', async () => {
    db.query.mockResolvedValueOnce([[]]);
    await service.allocateTunnelIp();
    const [sql] = db.query.mock.calls[0];
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/nas_wg_tunnels/);
  });
});

// =============================================================================
// syncPeer() — NAS peer on wg-fireisp
// =============================================================================

describe('syncPeer()', () => {
  const PUB = 'VGVzdFB1YmxpY0tleUJhc2U2NEVuY29kZWRBQUE=';
  const TUNNEL_IP = '10.255.0.5';

  test('calls wg set with correct peer argv (no extra subnets)', async () => {
    const result = await service.syncPeer({ publicKey: PUB, tunnelIp: TUNNEL_IP });

    expect(result).toEqual({ applied: true });
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'wg',
      ['set', 'wg-fireisp', 'peer', PUB, 'allowed-ips', `${TUNNEL_IP}/32`],
      { encoding: 'utf8' },
      expect.any(Function),
    );
  });

  test('includes confirmed subnets in wg set allowed-ips', async () => {
    const subnets = ['192.168.1.0/24', '192.168.2.0/24'];
    await service.syncPeer({ publicKey: PUB, tunnelIp: TUNNEL_IP, subnets });

    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'wg',
      ['set', 'wg-fireisp', 'peer', PUB, 'allowed-ips',
        `${TUNNEL_IP}/32,${subnets.join(',')}`],
      { encoding: 'utf8' },
      expect.any(Function),
    );
  });

  test('installs ip route replace for the tunnel /32', async () => {
    await service.syncPeer({ publicKey: PUB, tunnelIp: TUNNEL_IP });

    expect(execFile).toHaveBeenCalledWith(
      'ip',
      ['route', 'replace', `${TUNNEL_IP}/32`, 'dev', 'wg-fireisp'],
      { encoding: 'utf8' },
      expect.any(Function),
    );
  });

  test('installs ip route replace for each confirmed subnet', async () => {
    const subnets = ['10.10.0.0/24', '10.20.0.0/24'];
    await service.syncPeer({ publicKey: PUB, tunnelIp: TUNNEL_IP, subnets });

    for (const subnet of subnets) {
      expect(execFile).toHaveBeenCalledWith(
        'ip',
        ['route', 'replace', subnet, 'dev', 'wg-fireisp'],
        { encoding: 'utf8' },
        expect.any(Function),
      );
    }
  });

  test('total execFile call count is 1 wg + 1 route (no subnets)', async () => {
    await service.syncPeer({ publicKey: PUB, tunnelIp: TUNNEL_IP });
    expect(execFile).toHaveBeenCalledTimes(2); // wg set + ip route replace /32
  });

  test('returns NOOP result and never calls execFile when serverEnabled=false', async () => {
    config.wireguard.serverEnabled = false;
    const result = await service.syncPeer({ publicKey: PUB, tunnelIp: TUNNEL_IP });

    expect(result).toMatchObject({ applied: false });
    expect(result.reason).toBeTruthy();
    expect(execFile).not.toHaveBeenCalled();
  });
});

// =============================================================================
// removePeer() — NAS peer cleanup
// =============================================================================

describe('removePeer()', () => {
  const PUB = 'VGVzdFB1YmxpY0tleUJhc2U2NEVuY29kZWRBQUE=';
  const SUBNETS = ['10.255.0.5/32', '192.168.10.0/24'];

  test('calls wg set peer remove with correct argv', async () => {
    const result = await service.removePeer({ publicKey: PUB, subnets: SUBNETS });

    expect(result).toEqual({ applied: true });
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'wg',
      ['set', 'wg-fireisp', 'peer', PUB, 'remove'],
      { encoding: 'utf8' },
      expect.any(Function),
    );
  });

  test('calls ip route del for each subnet', async () => {
    await service.removePeer({ publicKey: PUB, subnets: SUBNETS });

    for (const subnet of SUBNETS) {
      expect(execFile).toHaveBeenCalledWith(
        'ip',
        ['route', 'del', subnet, 'dev', 'wg-fireisp'],
        { encoding: 'utf8' },
        expect.any(Function),
      );
    }
  });

  test('returns {applied:true} even when route del fails (best-effort cleanup)', async () => {
    // wg set succeeds, ip route del fails
    execFile
      .mockImplementationOnce((_c, _a, _o, cb) => cb(null, { stdout: '', stderr: '' }))
      .mockImplementation((_c, _a, _o, cb) => cb(new Error('No such route')));

    const result = await service.removePeer({ publicKey: PUB, subnets: SUBNETS });
    expect(result).toEqual({ applied: true });
  });

  test('returns NOOP result and never calls execFile when serverEnabled=false', async () => {
    config.wireguard.serverEnabled = false;
    const result = await service.removePeer({ publicKey: PUB });

    expect(result).toMatchObject({ applied: false });
    expect(execFile).not.toHaveBeenCalled();
  });
});
