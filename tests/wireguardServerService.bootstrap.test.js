// =============================================================================
// FireISP 5.0 — WireGuard Server Service Tests — host bootstrap
// =============================================================================
// Covers bootstrapHost(): first-run key generation + interface bring-up, second-
// run idempotency (no key rewrite, no interface re-create), dormant no-op, and
// best-effort tolerance of "already exists" on redeploy. All host side-effects
// (child_process.execFile, fs) are mocked — no live system required.
// =============================================================================

'use strict';

// ─── Mocks (hoisted by Jest before any require) ───────────────────────────────

jest.mock('child_process', () => ({ execFile: jest.fn() }));

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  mkdirSync: jest.fn(),
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
    keyDir: '/etc/wireguard',
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
const fs = require('fs');
const config = require('../src/config');
const service = require('../src/services/wireguardServerService');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Install an args-aware execFile router so assertions don't depend on call
 * ordering. By default every call succeeds; `ifaceUp`/`tableExists` flip the two
 * existence probes, and `failLinkAdd` makes `ip link add` reject once.
 */
function routeExec({ ifaceUp = false, tableExists = false, failLinkAdd = false } = {}) {
  execFile.mockImplementation((cmd, args, _opts, cb) => {
    if (cmd === 'ip' && args[0] === 'link' && args[1] === 'show') {
      return ifaceUp
        ? cb(null, { stdout: '', stderr: '' })
        : cb(new Error(`Device "${args[2]}" does not exist.`));
    }
    if (cmd === 'ip' && args[0] === 'link' && args[1] === 'add' && failLinkAdd) {
      return cb(new Error('RTNETLINK answers: File exists'));
    }
    if (cmd === 'nft' && args[0] === 'list' && args[1] === 'table') {
      return tableExists
        ? cb(null, { stdout: 'table inet fireisp_wg {}', stderr: '' })
        : cb(new Error('No such file or directory'));
    }
    return cb(null, { stdout: '', stderr: '' });
  });
}

/** True if execFile was called with this command and leading args prefix. */
function execCalledWith(cmd, argsPrefix) {
  return execFile.mock.calls.some(
    ([c, a]) => c === cmd && Array.isArray(a) && argsPrefix.every((x, i) => a[i] === x),
  );
}

/** The fs.writeFileSync call whose path === target, or undefined. */
function writeCallFor(targetPath) {
  return fs.writeFileSync.mock.calls.find(([p]) => p === targetPath);
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the shared config mock to a clean enabled state.
  config.wireguard.serverEnabled = true;
  config.wireguard.serverPublicKey = '';
  config.wireguard.clientPublicKey = '';
  config.wireguard.keyDir = '/etc/wireguard';
});

// =============================================================================
// bootstrapHost() — first run
// =============================================================================

describe('bootstrapHost() — first run (nothing provisioned yet)', () => {
  beforeEach(() => {
    fs.existsSync.mockReturnValue(false); // no persisted keys, fresh volume
    routeExec({ ifaceUp: false, tableExists: false });
  });

  test('generates + persists both server keypairs with 0600 perms', async () => {
    await service.bootstrapHost();

    for (const iface of ['wg-fireisp', 'wg-clients']) {
      const keyCall = writeCallFor(`/etc/wireguard/${iface}.key`);
      expect(keyCall).toBeTruthy();
      expect(typeof keyCall[1]).toBe('string');
      expect(keyCall[1]).toHaveLength(44);          // base64 x25519 key
      expect(keyCall[2]).toEqual({ mode: 0o600 });  // private key locked down

      const pubCall = writeCallFor(`/etc/wireguard/${iface}.pub`);
      expect(pubCall).toBeTruthy();
      expect(pubCall[2]).toEqual({ mode: 0o644 });
    }
  });

  test('creates, keys (by file path), addresses, and brings up both interfaces', async () => {
    await service.bootstrapHost();

    // wg-fireisp on 10.255.0.1, port 51820
    expect(execCalledWith('ip', ['link', 'add', 'dev', 'wg-fireisp', 'type', 'wireguard'])).toBe(true);
    expect(execCalledWith('wg', ['set', 'wg-fireisp', 'private-key', '/etc/wireguard/wg-fireisp.key', 'listen-port', '51820'])).toBe(true);
    expect(execCalledWith('ip', ['address', 'add', '10.255.0.1/16', 'dev', 'wg-fireisp'])).toBe(true);
    expect(execCalledWith('ip', ['link', 'set', 'up', 'dev', 'wg-fireisp'])).toBe(true);

    // wg-clients on 10.99.0.1, port 51821
    expect(execCalledWith('wg', ['set', 'wg-clients', 'private-key', '/etc/wireguard/wg-clients.key', 'listen-port', '51821'])).toBe(true);
    expect(execCalledWith('ip', ['address', 'add', '10.99.0.1/16', 'dev', 'wg-clients'])).toBe(true);
  });

  test('never passes a raw private key in argv (only the key file path)', async () => {
    await service.bootstrapHost();
    const keyFileArg = '/etc/wireguard/wg-fireisp.key';
    for (const [, args] of execFile.mock.calls) {
      // The only key reference allowed in argv is the file PATH, not the key bytes.
      for (const a of args) {
        if (typeof a === 'string' && a.length === 44 && /^[A-Za-z0-9+/]{43}=$/.test(a)) {
          throw new Error(`raw key leaked into argv: ${a}`);
        }
      }
    }
    expect(execCalledWith('wg', ['set', 'wg-fireisp', 'private-key', keyFileArg])).toBe(true);
  });

  test('enables ip_forward and installs the nftables base', async () => {
    await service.bootstrapHost();
    expect(execCalledWith('sysctl', ['-w', 'net.ipv4.ip_forward=1'])).toBe(true);
    // ensureBaseFirewall writes an nft script then applies it with `nft -f`
    expect(execCalledWith('nft', ['-f'])).toBe(true);
  });

  test('populates config public keys (44-char base64 decoding to 32 bytes)', async () => {
    const result = await service.bootstrapHost();
    expect(result).toMatchObject({ applied: true });

    expect(config.wireguard.serverPublicKey).toHaveLength(44);
    expect(config.wireguard.clientPublicKey).toHaveLength(44);
    expect(Buffer.from(config.wireguard.serverPublicKey, 'base64')).toHaveLength(32);
    expect(Buffer.from(config.wireguard.clientPublicKey, 'base64')).toHaveLength(32);
  });
});

// =============================================================================
// bootstrapHost() — second run (idempotency)
// =============================================================================

describe('bootstrapHost() — second run (already provisioned)', () => {
  const PERSISTED_PUB = 'A'.repeat(43) + '='; // 44-char stand-in public key

  beforeEach(() => {
    fs.existsSync.mockReturnValue(true);           // keys + interfaces already exist
    fs.readFileSync.mockReturnValue(PERSISTED_PUB);
    routeExec({ ifaceUp: true, tableExists: true });
  });

  test('does not regenerate or overwrite the persisted keys', async () => {
    await service.bootstrapHost();
    const keyWrite = fs.writeFileSync.mock.calls.find(([p]) => String(p).endsWith('.key'));
    expect(keyWrite).toBeFalsy();
    const pubWrite = fs.writeFileSync.mock.calls.find(([p]) => String(p).endsWith('.pub'));
    expect(pubWrite).toBeFalsy();
  });

  test('does not re-create interfaces and skips nft install when already present', async () => {
    await service.bootstrapHost();
    expect(execCalledWith('ip', ['link', 'add'])).toBe(false);
    // ensureBaseFirewall sees the table and short-circuits — no `nft -f`
    expect(execCalledWith('nft', ['-f'])).toBe(false);
  });

  test('still re-asserts keys/up idempotently and reads pubkeys from disk', async () => {
    const result = await service.bootstrapHost();
    expect(result).toMatchObject({ applied: true });
    expect(execCalledWith('wg', ['set', 'wg-fireisp', 'private-key', '/etc/wireguard/wg-fireisp.key', 'listen-port', '51820'])).toBe(true);
    expect(execCalledWith('ip', ['link', 'set', 'up', 'dev', 'wg-clients'])).toBe(true);
    expect(config.wireguard.serverPublicKey).toBe(PERSISTED_PUB);
    expect(config.wireguard.clientPublicKey).toBe(PERSISTED_PUB);
  });
});

// =============================================================================
// bootstrapHost() — dormant + resilience
// =============================================================================

describe('bootstrapHost() — recovers a lost public-key file', () => {
  test('rederives + rewrites the .pub from the surviving private key', async () => {
    // A real keypair: private key survives on disk, the .pub was lost.
    const kp = service.generateKeypair();
    fs.existsSync.mockImplementation((p) => String(p).endsWith('.key')); // .key present, .pub gone
    fs.readFileSync.mockReturnValue(kp.privateKey);
    routeExec({ ifaceUp: true, tableExists: true });

    const result = await service.bootstrapHost();
    expect(result).toMatchObject({ applied: true });

    // The recovered public key must match the keypair's real public key…
    expect(config.wireguard.serverPublicKey).toBe(kp.publicKey);
    expect(config.wireguard.clientPublicKey).toBe(kp.publicKey);

    // …and be rewritten to the .pub file with 0644 perms (never the .key).
    const pubWrite = writeCallFor('/etc/wireguard/wg-fireisp.pub');
    expect(pubWrite).toBeTruthy();
    expect(pubWrite[1]).toBe(kp.publicKey);
    expect(pubWrite[2]).toEqual({ mode: 0o644 });
    expect(fs.writeFileSync.mock.calls.find(([p]) => String(p).endsWith('.key'))).toBeFalsy();
  });
});

describe('bootstrapHost() — dormant + resilience', () => {
  test('is a no-op when WG_SERVER_ENABLED=false', async () => {
    config.wireguard.serverEnabled = false;
    routeExec();

    const result = await service.bootstrapHost();

    expect(result).toMatchObject({ applied: false });
    expect(execFile).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  test('tolerates "File exists" on interface create (redeploy) without throwing', async () => {
    fs.existsSync.mockReturnValue(false);
    routeExec({ ifaceUp: false, tableExists: false, failLinkAdd: true });

    const result = await service.bootstrapHost();

    expect(result).toMatchObject({ applied: true });
    // bring-up continued past the failed create
    expect(execCalledWith('ip', ['link', 'set', 'up', 'dev', 'wg-fireisp'])).toBe(true);
  });
});
