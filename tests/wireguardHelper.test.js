'use strict';

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

jest.mock('../src/services/wireguardServerService', () => ({
  bootstrapHost: jest.fn().mockResolvedValue({ applied: true }),
  shutdownHost: jest.fn().mockResolvedValue({ applied: true }),
  syncPeer: jest.fn().mockResolvedValue({ applied: true }),
  removePeer: jest.fn().mockResolvedValue({ applied: true }),
  syncUserPeer: jest.fn().mockResolvedValue({ applied: true }),
  readPeerHandshakes: jest.fn().mockResolvedValue({}),
  ensureBaseFirewall: jest.fn().mockResolvedValue({ applied: true }),
  setUserForwardScope: jest.fn().mockResolvedValue({ applied: true }),
  removeUserPeer: jest.fn().mockResolvedValue({ applied: true }),
}));

jest.mock('../src/utils/logger', () => ({
  child: () => ({ info: jest.fn(), error: jest.fn() }),
}));

const wireguard = require('../src/services/wireguardServerService');
const { createServer, operations, validCidr } = require('../src/scripts/wireguard-helper');

const KEY = `${'A'.repeat(43)}=`;

describe('privileged WireGuard helper allowlist', () => {
  beforeEach(() => jest.clearAllMocks());

  test('exposes semantic operations rather than a command execution primitive', () => {
    expect(Object.keys(operations).sort()).toEqual([
      'bootstrapHost', 'ensureBaseFirewall', 'readPeerHandshakes', 'removePeer',
      'removeUserPeer', 'setUserForwardScope', 'shutdownHost', 'syncPeer', 'syncUserPeer',
    ]);
    expect(operations).not.toHaveProperty('exec');
    expect(Object.hasOwn(operations, 'constructor')).toBe(false);
  });

  test('rejects inherited object names at the RPC boundary', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fireisp-wg-helper-test-'));
    const socketPath = path.join(dir, 'helper.sock');
    const server = createServer();
    await new Promise(resolve => server.listen(socketPath, resolve));
    try {
      const response = await new Promise((resolve, reject) => {
        const payload = JSON.stringify({ operation: 'constructor', params: {} });
        const req = http.request({ socketPath, path: '/v1/operation', method: 'POST' }, (res) => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end(payload);
      });
      expect(response).toMatchObject({ status: 422 });
      expect(response.body).toMatch(/not allowed/);
    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('validates peer material before invoking privileged code', async () => {
    await expect(operations.syncPeer({
      publicKey: 'not-a-key', tunnelIp: '10.255.0.2', subnets: [],
    })).rejects.toThrow(/publicKey/);
    expect(wireguard.syncPeer).not.toHaveBeenCalled();
  });

  test('passes a valid structured peer request without accepting argv or paths', async () => {
    const params = { publicKey: KEY, tunnelIp: '10.255.0.2', subnets: ['192.0.2.0/24'] };
    await expect(operations.syncPeer(params)).resolves.toEqual({ applied: true });
    expect(wireguard.syncPeer).toHaveBeenCalledWith(params);
  });

  test('limits handshake reads to the two configured interfaces', async () => {
    await expect(operations.readPeerHandshakes({ iface: 'wg-fireisp' })).resolves.toEqual({});
    await expect(operations.readPeerHandshakes({ iface: 'wg-attacker' }))
      .rejects.toThrow(/configured WireGuard interface/);
    expect(wireguard.readPeerHandshakes).toHaveBeenCalledTimes(1);
  });

  test.each(['192.0.2.0/24', '10.0.0.1/32'])('accepts valid CIDR %s', (cidr) => {
    expect(validCidr(cidr)).toBe(true);
  });

  test.each(['192.0.2.0', '999.0.0.1/24', '10.0.0.1/99', 'x; nft flush ruleset'])('rejects invalid CIDR %s', (cidr) => {
    expect(validCidr(cidr)).toBe(false);
  });
});
