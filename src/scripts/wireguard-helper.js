// =============================================================================
// FireISP privileged WireGuard helper
// =============================================================================
// Runs as the only production process with CAP_NET_ADMIN. It has no database,
// Redis, JWT, or encryption environment and is reachable only through a Unix
// socket shared with the non-root app container. The API is semantic and
// allowlisted: callers cannot submit a command, argv, shell text, or file path.
// =============================================================================

'use strict';

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

// Ensure direct execution even if somebody accidentally supplies the client
// socket variable to this container.
process.env.WG_PRIVILEGED_HELPER = 'true';
process.env.WG_SERVER_ENABLED = 'true';

const wireguard = require('../services/wireguardServerService');
const config = require('../config');
const logger = require('../utils/logger').child({ service: 'wireguardHelper' });

const SOCKET_PATH = process.env.WG_HELPER_SOCKET || '/run/fireisp-wireguard/helper.sock';
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

function validCidr(value) {
  if (typeof value !== 'string') return false;
  const [address, prefix, extra] = value.split('/');
  return extra === undefined && net.isIP(address) === 4
    && /^\d{1,2}$/.test(prefix || '') && Number(prefix) >= 0 && Number(prefix) <= 32;
}

function validIp(value) {
  return typeof value === 'string' && net.isIP(value) === 4;
}

function assert(condition, message) {
  if (!condition) {
    const err = new Error(message);
    err.statusCode = 422;
    throw err;
  }
}

function assertObject(value) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'params must be an object');
  return value;
}

function assertPeerParams(params, { user = false } = {}) {
  const p = assertObject(params);
  assert(KEY_RE.test(p.publicKey || ''), 'publicKey must be a WireGuard public key');
  assert(validIp(p.tunnelIp), 'tunnelIp must be IPv4');
  if (user) {
    assert(p.presharedKey === null || p.presharedKey === undefined || KEY_RE.test(p.presharedKey), 'presharedKey must be a WireGuard key');
  } else {
    assert(Array.isArray(p.subnets) && p.subnets.length <= 256 && p.subnets.every(validCidr), 'subnets must be IPv4 CIDRs');
  }
  return p;
}

const operations = Object.freeze({
  bootstrapHost: async (params) => {
    assert(Object.keys(assertObject(params)).length === 0, 'bootstrapHost takes no parameters');
    return wireguard.bootstrapHost();
  },
  shutdownHost: async (params) => {
    assert(Object.keys(assertObject(params)).length === 0, 'shutdownHost takes no parameters');
    return wireguard.shutdownHost();
  },
  syncPeer: async (params) => wireguard.syncPeer(assertPeerParams(params)),
  removePeer: async (params) => {
    const p = assertObject(params);
    assert(KEY_RE.test(p.publicKey || ''), 'publicKey must be a WireGuard public key');
    assert(Array.isArray(p.subnets) && p.subnets.length <= 256 && p.subnets.every(validCidr), 'subnets must be IPv4 CIDRs');
    return wireguard.removePeer(p);
  },
  syncUserPeer: async (params) => wireguard.syncUserPeer(assertPeerParams(params, { user: true })),
  readPeerHandshakes: async (params) => {
    const p = assertObject(params);
    assert(
      [config.wireguard.serverInterface, config.wireguard.clientInterface].includes(p.iface),
      'iface is not a configured WireGuard interface',
    );
    return wireguard.readPeerHandshakes(p.iface);
  },
  ensureBaseFirewall: async (params) => {
    assert(Object.keys(assertObject(params)).length === 0, 'ensureBaseFirewall takes no parameters');
    return wireguard.ensureBaseFirewall();
  },
  setUserForwardScope: async (params) => {
    const p = assertObject(params);
    assert(Number.isSafeInteger(p.peerId) && p.peerId > 0, 'peerId must be a positive integer');
    assert(validIp(p.tunnelIp), 'tunnelIp must be IPv4');
    assert(Array.isArray(p.subnets) && p.subnets.length <= 256 && p.subnets.every(validCidr), 'subnets must be IPv4 CIDRs');
    return wireguard.setUserForwardScope(p);
  },
  removeUserPeer: async (params) => {
    const p = assertObject(params);
    assert(KEY_RE.test(p.publicKey || ''), 'publicKey must be a WireGuard public key');
    assert(Number.isSafeInteger(p.peerId) && p.peerId > 0, 'peerId must be a positive integer');
    return wireguard.removeUserPeer(p);
  },
});

function createServer() {
  return http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/operation') {
      res.writeHead(404).end();
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        assert(typeof parsed.operation === 'string' && Object.hasOwn(operations, parsed.operation), 'operation is not allowed');
        const operation = operations[parsed.operation];
        const data = await operation(parsed.params || {});
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data }));
      } catch (err) {
        const status = err.statusCode || 500;
        if (status === 500) logger.error({ err, operation: (() => { try { return JSON.parse(body).operation; } catch (_) { return null; } })() }, 'WireGuard helper operation failed');
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: status === 500 ? 'WireGuard helper operation failed' : err.message }));
      }
    });
  });
}

function start() {
  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true, mode: 0o755 });
  try { fs.unlinkSync(SOCKET_PATH); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const server = createServer();
  server.listen(SOCKET_PATH, () => {
    fs.chmodSync(SOCKET_PATH, 0o666);
    logger.info({ socket: SOCKET_PATH }, 'WireGuard helper ready');
  });
  const stop = () => server.close(() => {
    try { fs.unlinkSync(SOCKET_PATH); } catch (_) { /* already gone */ }
    process.exit(0);
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  return server;
}

if (require.main === module) start();

module.exports = { createServer, operations, validCidr };
