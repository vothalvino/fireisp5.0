// =============================================================================
// FireISP 5.0 — WireGuard Hub Service (§2)
// =============================================================================
// The ONLY module that shells out to wg/ip/nft. All child processes use
// execFile with array argv — never string concatenation or shell:true.
//
// Two surfaces, one module, interface-parameterized:
//   wg-fireisp  — per-NAS tunnels (Part 1). Peers dial in; FireISP routes to
//                 device subnets. Subnet: WG_SERVER_SUBNET (10.255.0.0/16).
//   wg-clients  — user access tunnels (Part 2). Roaming clients (laptop/phone)
//                 dial in; FireISP forwards through wg-fireisp to device subnets
//                 under per-user nftables FORWARD ACL + MASQUERADE.
//                 Subnet: WG_CLIENT_SUBNET (10.99.0.0/16).
//
// HARD CONSTRAINT: no writes to /ip/service or /ip/firewall on any RouterOS
// device (those are entirely separate from this module). The only RouterOS
// writes are done by routerosService.js wireguard* helpers.
//
// Security invariants:
//   - Private and preshared keys are NEVER logged.
//   - PSK is passed to `wg` via a 0600 temp keyfile, not argv.
//   - All nft updates use temp files and `nft -f` (array argv, no shell).
//   - When config.wireguard.serverEnabled is false every shell-out function
//     returns { applied: false, reason } without executing anything.
//
// Deployment prerequisite (Ubuntu Linux):
//   - wireguard-tools, nftables, iproute2 installed; CAP_NET_ADMIN on the process.
//   - bootstrapHost() (called at startup) auto-provisions both interfaces: it
//     generates + persists the server keypairs to WG_KEY_DIR, brings wg-fireisp +
//     wg-clients up, sets net.ipv4.ip_forward=1, and installs the nft base. The
//     server private keys live only in WG_KEY_DIR — NEVER in the DB or git.
//   - Self-managed alternative: bring the interfaces up yourself (host wg-quick@)
//     and pin WG_*_PUBLIC_KEY to the matching keys (docs/wireguard-setup.md §2).
//
// RouterOS 7 only — no v6 fallbacks.
// =============================================================================

'use strict';

const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const fs = require('fs');
const path = require('path');

const config = require('../config');
const db = require('../config/database');
const { ValidationError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'wireguardServerService' });

const execFileP = promisify(execFile);

// =============================================================================
// Internal constants & helpers
// =============================================================================

/** Sentinel returned by every shell-out function when the hub is disabled. */
const NOOP_RESULT = Object.freeze({ applied: false, reason: 'WG_SERVER_ENABLED is false' });

/**
 * Execute a binary with an explicit argument array.
 * Never use shell:true or string concatenation.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{stdout:string, stderr:string}>}
 */
function execFileAsync(cmd, args) {
  return execFileP(cmd, args, { encoding: 'utf8' });
}

/**
 * Write content to a 0600 temp file and return its path.
 * Used for nft scripts and PSK keyfiles — never for key material in argv.
 *
 * @param {string} content
 * @returns {string} absolute path to the temp file
 */
function writeTmpFile(content) {
  const tmpPath = path.join(
    os.tmpdir(),
    `fireisp-wg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  return tmpPath;
}

/** Best-effort unlink of a temp file (logs on error, never throws). */
function unlinkSafe(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    logger.debug({ filePath, err: err.message }, 'wireguardServerService: temp file unlink failed');
  }
}

// =============================================================================
// IP arithmetic helpers
// =============================================================================

/**
 * Convert a dotted-quad IPv4 string to an unsigned 32-bit integer.
 * @param {string} ip
 * @returns {number}
 */
function ipToInt(ip) {
  const [a, b, c, d] = ip.split('.').map(Number);
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/**
 * Convert an unsigned 32-bit integer to a dotted-quad IPv4 string.
 * @param {number} n
 * @returns {string}
 */
function intToIp(n) {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ].join('.');
}

/**
 * Parse a CIDR string into the network and broadcast integers (inclusive).
 * @param {string} cidr  e.g. '10.255.0.0/16'
 * @returns {{ network: number, broadcast: number }}
 */
function subnetToRange(cidr) {
  const [ip, prefixStr] = cidr.split('/');
  const prefixLen = parseInt(prefixStr, 10);
  const shift = 32 - prefixLen;
  // Guard against /0 (full mask) — shift of 32 is undefined in JS bitwise
  const hostMask = shift >= 32 ? 0xffffffff : ((1 << shift) - 1) >>> 0;
  const netMask = (~hostMask) >>> 0;
  const network = (ipToInt(ip) & netMask) >>> 0;
  const broadcast = (network | hostMask) >>> 0;
  return { network, broadcast };
}

// =============================================================================
// Part 1 — NAS peer management on wg-fireisp
// =============================================================================

/**
 * Generate a WireGuard x25519 keypair.
 *
 * Returns raw 32-byte keys in WireGuard base64 format (44 chars) by slicing
 * the fixed-length DER headers from PKCS8 (private, 48 bytes, key at +16) and
 * SPKI (public, 44 bytes, key at +12).
 *
 * SECURITY: caller must not log the returned privateKey.
 *
 * @returns {{ privateKey: string, publicKey: string }}
 */
function generateKeypair() {
  const { privateKey: privDer, publicKey: pubDer } = crypto.generateKeyPairSync('x25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
    publicKeyEncoding:  { type: 'spki',  format: 'der' },
  });
  // PKCS8 DER for x25519 is always 48 bytes; the 32-byte raw key starts at byte 16.
  // SPKI DER for x25519 is always 44 bytes; the 32-byte raw key starts at byte 12.
  return {
    privateKey: privDer.slice(16).toString('base64'),
    publicKey:  pubDer.slice(12).toString('base64'),
  };
}

/**
 * The fixed 16-byte PKCS8 DER prefix that precedes the 32-byte raw key in an
 * x25519 private key (SEQUENCE → version 0 → AlgId OID 1.3.101.110 → OCTET STRING).
 * Prepending it to a raw private key lets crypto re-derive the public key.
 */
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

/**
 * Derive the WireGuard base64 public key from a base64 private key.
 *
 * Used to recover an interface's public key when its persisted `.pub` file is
 * missing but its `.key` file survives, without invoking `wg pubkey` (which
 * would require feeding the key on stdin).
 *
 * @param {string} privateKeyB64  44-char base64 x25519 private key
 * @returns {string} 44-char base64 public key
 */
function publicKeyFromPrivate(privateKeyB64) {
  const raw = Buffer.from(privateKeyB64, 'base64');
  const der = Buffer.concat([X25519_PKCS8_PREFIX, raw]);
  const keyObj = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const pubDer = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
  return pubDer.slice(12).toString('base64');
}

/**
 * Allocate the lowest free host address in the NAS tunnel pool.
 *
 * Reads all currently-live `tunnel_address` values from `nas_wg_tunnels` and
 * returns the first address in WG_SERVER_SUBNET not already taken. The DB
 * unique constraint `uq_wg_tunnel_ip` enforces final uniqueness; call-site
 * should catch ER_DUP_ENTRY and retry.
 *
 * @returns {Promise<string>} dotted-quad IPv4 (no prefix length)
 * @throws {ValidationError} when the entire pool is exhausted
 */
async function allocateTunnelIp() {
  const { network, broadcast } = subnetToRange(config.wireguard.serverSubnet);
  const [rows] = await db.query(
    'SELECT tunnel_address FROM nas_wg_tunnels WHERE deleted_at IS NULL',
  );
  const used = new Set(rows.map((r) => r.tunnel_address));
  // Skip network (.0), the reserved server-interface address (network+1, e.g.
  // 10.255.0.1 — the host's own wg-fireisp IP), and broadcast. Peers start at
  // network+2 so the allocator never hands a NAS the server's own address.
  for (let n = network + 2; n < broadcast; n++) {
    const ip = intToIp(n);
    if (!used.has(ip)) return ip;
  }
  throw new ValidationError(
    `WireGuard NAS tunnel address pool exhausted (subnet: ${config.wireguard.serverSubnet})`,
  );
}

/**
 * Add or update a NAS peer on the wg-fireisp interface.
 *
 * Idempotent — `wg set` replaces any existing peer entry for `publicKey`.
 * After updating the peer, installs host and subnet routes via `ip route replace`.
 *
 * @param {object} opts
 * @param {string} opts.publicKey   WireGuard base64 public key of the NAS
 * @param {string} opts.tunnelIp    The NAS's /32 tunnel address (no prefix)
 * @param {string[]} [opts.subnets] Additional CIDRs routed via this NAS
 * @returns {Promise<{applied:boolean}>}
 */
async function syncPeer({ publicKey, tunnelIp, subnets = [] }) {
  if (!config.wireguard.serverEnabled) return { ...NOOP_RESULT };

  const iface = config.wireguard.serverInterface;
  // allowed-ips: the NAS tunnel /32 plus any confirmed routed subnets
  const allowedIps = [`${tunnelIp}/32`, ...subnets].join(',');

  logger.info({ iface, tunnelIp, subnetCount: subnets.length }, 'wg syncPeer');
  await execFileAsync('wg', ['set', iface, 'peer', publicKey, 'allowed-ips', allowedIps]);

  // Install kernel routes so the host knows to forward traffic via the tunnel
  await execFileAsync('ip', ['route', 'replace', `${tunnelIp}/32`, 'dev', iface]);
  for (const subnet of subnets) {
    await execFileAsync('ip', ['route', 'replace', subnet, 'dev', iface]);
  }

  return { applied: true };
}

/**
 * Remove a NAS peer from wg-fireisp and clean up its kernel routes.
 *
 * Route cleanup is best-effort — errors are logged but not re-thrown.
 *
 * @param {object} opts
 * @param {string} opts.publicKey  WireGuard base64 public key of the NAS
 * @param {string[]} [opts.subnets] All CIDRs (including tunnelIp/32) to remove
 * @returns {Promise<{applied:boolean}>}
 */
async function removePeer({ publicKey, subnets = [] }) {
  if (!config.wireguard.serverEnabled) return { ...NOOP_RESULT };

  const iface = config.wireguard.serverInterface;

  logger.info({ iface, subnetCount: subnets.length }, 'wg removePeer');
  await execFileAsync('wg', ['set', iface, 'peer', publicKey, 'remove']);

  for (const subnet of subnets) {
    try {
      await execFileAsync('ip', ['route', 'del', subnet, 'dev', iface]);
    } catch (err) {
      logger.warn({ subnet, iface, err: err.message }, 'wg removePeer: route del failed (non-fatal)');
    }
  }

  return { applied: true };
}

// =============================================================================
// Part 2 — User peer management on wg-clients
// =============================================================================

/**
 * Allocate the lowest free host address in the user client tunnel pool.
 *
 * Reads all currently-live `tunnel_address` values from `wg_user_peers` and
 * returns the first address in WG_CLIENT_SUBNET not already taken. The DB
 * unique constraint `uq_wg_user_ip` enforces final uniqueness; call-site
 * should catch ER_DUP_ENTRY and retry.
 *
 * @returns {Promise<string>} dotted-quad IPv4 (no prefix length)
 * @throws {ValidationError} when the entire pool is exhausted
 */
async function allocateUserTunnelIp() {
  const { network, broadcast } = subnetToRange(config.wireguard.clientSubnet);
  const [rows] = await db.query(
    'SELECT tunnel_address FROM wg_user_peers WHERE deleted_at IS NULL',
  );
  const used = new Set(rows.map((r) => r.tunnel_address));
  // Reserve network+1 (e.g. 10.99.0.1) for the host's own wg-clients interface;
  // user peers start at network+2.
  for (let n = network + 2; n < broadcast; n++) {
    const ip = intToIp(n);
    if (!used.has(ip)) return ip;
  }
  throw new ValidationError(
    `WireGuard user tunnel address pool exhausted (subnet: ${config.wireguard.clientSubnet})`,
  );
}

/**
 * Add or update a user client peer on wg-clients.
 *
 * The server-side allowed-ips is ONLY the user's /32 (anti-spoof + return
 * path). Destination scope is enforced by the nftables FORWARD chain (see
 * setUserForwardScope), NOT by WireGuard allowed-ips.
 *
 * PSK is written to a 0600 temp file and passed as `preshared-key <file>` —
 * it NEVER appears in argv.
 *
 * @param {object} opts
 * @param {string} opts.publicKey      WireGuard base64 public key (client-side)
 * @param {string} opts.tunnelIp       The user's /32 tunnel address (no prefix)
 * @param {string|null} [opts.presharedKey]  Optional PSK (plaintext; handled via tmpfile)
 * @returns {Promise<{applied:boolean}>}
 */
async function syncUserPeer({ publicKey, tunnelIp, presharedKey = null }) {
  if (!config.wireguard.serverEnabled) return { ...NOOP_RESULT };

  const iface = config.wireguard.clientInterface;
  logger.info({ iface, tunnelIp }, 'wg syncUserPeer');

  let pskFile = null;
  try {
    if (presharedKey) {
      // Write PSK to a 0600 temp file — never include it in argv
      pskFile = writeTmpFile(presharedKey);
      await execFileAsync('wg', [
        'set', iface, 'peer', publicKey,
        'preshared-key', pskFile,
        'allowed-ips', `${tunnelIp}/32`,
      ]);
    } else {
      await execFileAsync('wg', [
        'set', iface, 'peer', publicKey,
        'allowed-ips', `${tunnelIp}/32`,
      ]);
    }
  } finally {
    if (pskFile) unlinkSafe(pskFile);
  }

  return { applied: true };
}

/**
 * Read live handshake + traffic stats for all peers on an interface.
 *
 * Runs `wg show <iface> dump` and parses tab-separated output. The first line
 * is interface info (contains the private key — we skip it immediately without
 * logging stdout).
 *
 * @param {string} iface  Interface name, e.g. 'wg-fireisp' or 'wg-clients'
 * @returns {Promise<Record<string, {lastHandshakeUnix:number, rxBytes:number, txBytes:number, endpoint:string|null}>>}
 *   Map keyed by peer public key. Returns {} when serverEnabled is false or on
 *   read failure (graceful degradation — the caller should surface this state).
 */
async function readPeerHandshakes(iface) {
  if (!config.wireguard.serverEnabled) return {};

  let stdout;
  try {
    ({ stdout } = await execFileAsync('wg', ['show', iface, 'dump']));
  } catch (err) {
    logger.warn({ iface, err: err.message }, 'wg readPeerHandshakes: wg show dump failed');
    return {};
  }

  const result = {};
  const lines = stdout.trim().split('\n').filter(Boolean);
  // Line 0 is the interface line (private-key, public-key, listen-port, fwmark).
  // Do NOT log it. Skip and process peer lines (index 1+).
  for (let i = 1; i < lines.length; i++) {
    // Peer line columns (tab-separated):
    // 0: public-key  1: preshared-key  2: endpoint  3: allowed-ips
    // 4: latest-handshake (unix sec, 0 = never)  5: rx-bytes  6: tx-bytes  7: keepalive
    const parts = lines[i].split('\t');
    if (parts.length < 8) continue;
    const pubKey = parts[0];
    const endpoint = parts[2];
    const lastHandshakeUnix = parseInt(parts[4], 10) || 0;
    const rxBytes = parseInt(parts[5], 10) || 0;
    const txBytes = parseInt(parts[6], 10) || 0;
    result[pubKey] = {
      lastHandshakeUnix,
      rxBytes,
      txBytes,
      endpoint: endpoint === '(none)' ? null : endpoint,
    };
  }
  return result;
}

// =============================================================================
// Part 2 — nftables firewall (base + per-user scope)
// =============================================================================

/**
 * Install the base nftables ruleset for the WireGuard hub (idempotent).
 *
 * Created once. Subsequent calls detect the existing table and return without
 * making changes. Per-user sets and accept rules are added by setUserForwardScope.
 *
 * Base structure:
 *   table inet fireisp_wg {
 *     chain forward  — hook forward, priority filter
 *       1. established/related from wg-fireisp→wg-clients: accept  (device replies)
 *       2. wg-clients→wg-clients: drop                             (no lateral movement)
 *       3. wg-clients→wg-fireisp: jump wg_user_fwd                (per-user ACL)
 *       4. wg-clients→wg-fireisp: drop                            (default-deny terminal)
 *     chain wg_user_fwd  — per-user accept rules (managed by setUserForwardScope)
 *     chain postrouting  — hook postrouting, priority srcnat
 *       MASQUERADE clientSubnet→wg-fireisp so device replies route back
 *   }
 *
 * Why MASQUERADE: the NAS peer's allowed-address is serverSubnet only (Part 1
 * §4); device replies to 10.99.x would be dropped by cryptokey routing without
 * SNAT. Source-visibility mode (adding clientSubnet to NAS allowed-address) is
 * a FOLLOW-UP.
 *
 * @returns {Promise<{applied:boolean, reason?:string}>}
 */
async function ensureBaseFirewall() {
  if (!config.wireguard.serverEnabled) return { ...NOOP_RESULT };

  // Check whether our table already exists (nft exits non-zero if not found)
  try {
    await execFileAsync('nft', ['list', 'table', 'inet', 'fireisp_wg']);
    return { applied: false, reason: 'fireisp_wg table already installed' };
  } catch (_) {
    // Table not found — proceed with installation
  }

  const clientIface  = config.wireguard.clientInterface;
  const serverIface  = config.wireguard.serverInterface;
  const clientSubnet = config.wireguard.clientSubnet;

  const nftConfig = [
    'table inet fireisp_wg {',
    '  chain forward {',
    '    type filter hook forward priority filter; policy accept;',
    '    # Device-to-user replies: allow established/related returning from the NAS side',
    `    iifname "${serverIface}" oifname "${clientIface}" ct state established,related accept`,
    '    # Kill technician-to-technician lateral movement',
    `    iifname "${clientIface}" oifname "${clientIface}" drop`,
    '    # Per-user accept rules managed by setUserForwardScope',
    `    iifname "${clientIface}" oifname "${serverIface}" jump wg_user_fwd`,
    '    # Default-deny terminal: all remaining wg-clients→wg-fireisp traffic is dropped',
    `    iifname "${clientIface}" oifname "${serverIface}" drop`,
    '  }',
    '  chain wg_user_fwd {',
    '    # Populated by wireguardServerService.setUserForwardScope()',
    '  }',
    '  chain postrouting {',
    '    type nat hook postrouting priority srcnat;',
    `    # MASQUERADE user client traffic so NAS peer replies route back via ${serverIface}`,
    `    ip saddr ${clientSubnet} oifname "${serverIface}" masquerade`,
    '  }',
    '}',
  ].join('\n');

  const tmpFile = writeTmpFile(nftConfig);
  try {
    await execFileAsync('nft', ['-f', tmpFile]);
  } finally {
    unlinkSafe(tmpFile);
  }

  logger.info(
    { clientIface, serverIface, clientSubnet },
    'wireguardServerService: base nftables firewall installed',
  );
  return { applied: true };
}

/**
 * Atomically set the forward scope for a single user peer.
 *
 * Creates (or updates) a named set `u<peerId>_dst` containing the CIDRs the
 * user is allowed to reach through wg-fireisp, then ensures a matching accept
 * rule exists in the `wg_user_fwd` chain. Rule addition is idempotent — the
 * existing ruleset is inspected before adding to avoid duplicates.
 *
 * Called on peer create and on every scope change (assignment update, role
 * change, NAS route change). The set element swap (flush → add) is atomic
 * within a single `nft -f` script invocation. An empty subnets array is valid
 * and results in an empty set: the user's tunnel stays up but no forwarding
 * is permitted until an admin assigns subnets.
 *
 * @param {object} opts
 * @param {number} opts.peerId    DB id of the wg_user_peers row (set name key)
 * @param {string} opts.tunnelIp  User's /32 tunnel address — source in accept rule
 * @param {string[]} opts.subnets Allowed destination CIDRs (may be empty)
 * @returns {Promise<{applied:boolean, reason?:string}>}
 */
async function setUserForwardScope({ peerId, tunnelIp, subnets = [] }) {
  if (!config.wireguard.serverEnabled) return { ...NOOP_RESULT };

  const setName   = `u${peerId}_dst`;
  const outIface  = config.wireguard.serverInterface;

  // ── Step 1: ensure the named set exists ────────────────────────────────────
  // `nft list set` exits non-zero when the set is absent; we create it via
  // an nft -f file only when needed to avoid a spurious "already exists" error.
  let setExists = false;
  try {
    await execFileAsync('nft', ['list', 'set', 'inet', 'fireisp_wg', setName]);
    setExists = true;
  } catch (_) {
    // Set does not yet exist
  }

  if (!setExists) {
    const createFile = writeTmpFile(
      `add set inet fireisp_wg ${setName} { type ipv4_addr; flags interval; }`,
    );
    try {
      await execFileAsync('nft', ['-f', createFile]);
    } finally {
      unlinkSafe(createFile);
    }
  }

  // ── Step 2: atomic set element swap (flush old, add new) ───────────────────
  const atomicLines = [`flush set inet fireisp_wg ${setName}`];
  if (subnets.length > 0) {
    atomicLines.push(
      `add element inet fireisp_wg ${setName} { ${subnets.join(', ')} }`,
    );
  }
  const atomicFile = writeTmpFile(atomicLines.join('\n'));
  try {
    await execFileAsync('nft', ['-f', atomicFile]);
  } finally {
    unlinkSafe(atomicFile);
  }

  // ── Step 3: ensure the accept rule exists in wg_user_fwd ──────────────────
  // Inspect the chain before adding to avoid accumulating duplicate rules.
  let chainDump;
  try {
    ({ stdout: chainDump } = await execFileAsync('nft', [
      'list', 'chain', 'inet', 'fireisp_wg', 'wg_user_fwd',
    ]));
  } catch (err) {
    // Chain not found — base firewall has not been applied yet
    logger.warn(
      { peerId, err: err.message },
      'setUserForwardScope: wg_user_fwd chain not found; call ensureBaseFirewall() first',
    );
    return { applied: false, reason: 'wg_user_fwd chain not found; ensureBaseFirewall() required' };
  }

  if (!chainDump.includes(`@${setName}`)) {
    const ruleFile = writeTmpFile(
      `add rule inet fireisp_wg wg_user_fwd ip saddr ${tunnelIp} ip daddr @${setName} oifname "${outIface}" accept`,
    );
    try {
      await execFileAsync('nft', ['-f', ruleFile]);
    } finally {
      unlinkSafe(ruleFile);
    }
    logger.info({ peerId, tunnelIp, subnets }, 'setUserForwardScope: accept rule added');
  } else {
    logger.debug({ peerId, tunnelIp }, 'setUserForwardScope: accept rule already present, set updated');
  }

  return { applied: true };
}

/**
 * Remove a user peer from wg-clients and tear down its nftables state.
 *
 * Sequence:
 *   1. `wg set wg-clients peer <pub> remove` — kernel stops decrypting/forwarding
 *      the peer's traffic on the next packet (WireGuard is connectionless).
 *   2. Find and delete the accept rule that references `u<peerId>_dst` from the
 *      `wg_user_fwd` chain (via nft JSON output).
 *   3. Delete the named set `u<peerId>_dst`.
 *
 * All nft operations are best-effort (logged on failure, never re-thrown) so
 * that stale DB state can be cleaned up even when the firewall is partially
 * inconsistent.
 *
 * @param {object} opts
 * @param {string} opts.publicKey  WireGuard base64 public key (client-side)
 * @param {number} opts.peerId     DB id of the wg_user_peers row
 * @returns {Promise<{applied:boolean}>}
 */
async function removeUserPeer({ publicKey, peerId }) {
  if (!config.wireguard.serverEnabled) return { ...NOOP_RESULT };

  const iface   = config.wireguard.clientInterface;
  const setName = `u${peerId}_dst`;

  logger.info({ iface, peerId }, 'wg removeUserPeer');

  // ── Step 1: remove the WireGuard kernel peer ──────────────────────────────
  try {
    await execFileAsync('wg', ['set', iface, 'peer', publicKey, 'remove']);
  } catch (err) {
    logger.warn({ peerId, err: err.message }, 'removeUserPeer: wg peer remove failed (non-fatal)');
  }

  // ── Step 2: delete the accept rule referencing u<peerId>_dst ─────────────
  try {
    const { stdout: jsonOut } = await execFileAsync('nft', [
      '-j', 'list', 'chain', 'inet', 'fireisp_wg', 'wg_user_fwd',
    ]);
    const parsed = JSON.parse(jsonOut);
    const ruleEntries = (parsed.nftables || []).filter((e) => e.rule);
    for (const entry of ruleEntries) {
      const rule = entry.rule;
      // Identify the rule for this peer by scanning its serialised expression
      // for the set name reference (robust against nft JSON schema variations)
      if (JSON.stringify(rule.expr || []).includes(setName)) {
        await execFileAsync('nft', [
          'delete', 'rule', 'inet', 'fireisp_wg', 'wg_user_fwd',
          'handle', String(rule.handle),
        ]);
        logger.debug({ peerId, handle: rule.handle }, 'removeUserPeer: nft accept rule deleted');
        break;
      }
    }
  } catch (err) {
    logger.warn({ peerId, err: err.message }, 'removeUserPeer: nft rule delete failed (non-fatal)');
  }

  // ── Step 3: delete the named set (rule must be gone first) ────────────────
  try {
    const delFile = writeTmpFile(`delete set inet fireisp_wg ${setName}`);
    try {
      await execFileAsync('nft', ['-f', delFile]);
    } finally {
      unlinkSafe(delFile);
    }
    logger.debug({ peerId, setName }, 'removeUserPeer: nft set deleted');
  } catch (err) {
    logger.warn({ peerId, setName, err: err.message }, 'removeUserPeer: nft set delete failed (non-fatal)');
  }

  return { applied: true };
}

// =============================================================================
// Host bootstrap — idempotent interface + key provisioning
// =============================================================================

/**
 * Run a side-effecting shell-out best-effort: log and swallow any failure.
 * Used for interface/address creation that is expected to already exist on a
 * redeploy (the kernel returns "File exists" / "RTNETLINK ... File exists").
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} label  short description for the warning log
 */
async function runBestEffort(cmd, args, label) {
  try {
    await execFileAsync(cmd, args);
  } catch (err) {
    logger.warn({ label, err: err.message }, `wireguardServerService: ${label} failed (non-fatal)`);
  }
}

/**
 * Adopt the public key actually bound to an interface into request-time config.
 * The on-disk/interface key is authoritative: if an operator pinned a different
 * WG_*_PUBLIC_KEY, warn (issued .conf/QR would otherwise advertise a key the
 * server does not hold → silent handshake failure). No-op when the interface
 * bring-up failed (actual undefined): the existing pinned/empty value is kept.
 *
 * @param {string} field    config.wireguard field to set
 * @param {string} envName  the env var name (for the warning)
 * @param {string|undefined} actual  the interface's real public key
 * @param {string} iface
 */
function reconcilePublicKey(field, envName, actual, iface) {
  if (!actual) return;
  if (config.wireguard[field] && config.wireguard[field] !== actual) {
    logger.warn(
      { iface, envName },
      `wireguardServerService: pinned ${envName} does not match the key bound to ${iface}; advertising the on-disk key`,
    );
  }
  config.wireguard[field] = actual;
}

/**
 * Ensure one WireGuard hub interface exists, is keyed, addressed, and up.
 *
 * Idempotent and safe to run on every boot:
 *   - generates the interface keypair ONLY when its private key file is absent,
 *     persisting both files to config.wireguard.keyDir (0600 key, 0644 pub) —
 *     keys never enter git, the image, or the DB;
 *   - (re)creates the interface, binds the private key (via file path, never
 *     argv) + listen port, assigns the host's `.1` address, and brings it up;
 *   - interface/address creation is best-effort so a redeploy against a host
 *     that already has the interface re-converges instead of throwing.
 *
 * @param {object} opts
 * @param {string} opts.iface       interface name, e.g. 'wg-fireisp'
 * @param {string} opts.subnet      CIDR pool; the host interface takes network+1
 * @param {number} opts.listenPort  UDP listen port for inbound peers
 * @returns {Promise<string>} the interface's base64 public key
 */
async function ensureInterface({ iface, subnet, listenPort }) {
  const keyDir  = config.wireguard.keyDir;
  const keyFile = path.posix.join(keyDir, `${iface}.key`);
  const pubFile = path.posix.join(keyDir, `${iface}.pub`);

  // ── Keys: generate once, then reuse the persisted pair forever ─────────────
  let publicKey;
  if (!fs.existsSync(keyFile)) {
    const pair = generateKeypair();
    fs.writeFileSync(keyFile, pair.privateKey, { mode: 0o600 });
    fs.writeFileSync(pubFile, pair.publicKey,  { mode: 0o644 });
    publicKey = pair.publicKey;
    logger.info({ iface, keyFile }, 'wireguardServerService: generated server keypair');
  } else if (fs.existsSync(pubFile)) {
    publicKey = fs.readFileSync(pubFile, 'utf8').trim();
  } else {
    // Private key survived but the .pub was lost — recompute and rewrite it.
    publicKey = publicKeyFromPrivate(fs.readFileSync(keyFile, 'utf8').trim());
    fs.writeFileSync(pubFile, publicKey, { mode: 0o644 });
    logger.warn({ iface, pubFile }, 'wireguardServerService: recovered missing public key from private key');
  }

  // ── Interface: create if absent, key it, address it, bring it up ───────────
  const { network } = subnetToRange(subnet);
  const hostIp = intToIp(network + 1);          // e.g. 10.255.0.1
  const prefix = subnet.split('/')[1];

  try {
    await execFileAsync('ip', ['link', 'show', iface]);
  } catch (_) {
    // Interface absent — create it (tolerate a concurrent/previous create).
    await runBestEffort('ip', ['link', 'add', 'dev', iface, 'type', 'wireguard'], `create ${iface}`);
  }

  // Bind the private key by FILE PATH (never argv) + listen port. Idempotent.
  await execFileAsync('wg', ['set', iface, 'private-key', keyFile, 'listen-port', String(listenPort)]);

  // Assign the host's .1 address (tolerate "File exists" on redeploy).
  await runBestEffort('ip', ['address', 'add', `${hostIp}/${prefix}`, 'dev', iface], `address ${iface}`);

  // Bring the interface up.
  await execFileAsync('ip', ['link', 'set', 'up', 'dev', iface]);

  return publicKey;
}

/**
 * Idempotently provision the WireGuard hub on the local host (the container's
 * own network namespace under CAP_NET_ADMIN). No-op unless WG_SERVER_ENABLED=true.
 *
 * On every boot this brings the hub from "nothing" to "ready to accept peers":
 *   1. ensures both interfaces exist + are keyed/addressed/up (ensureInterface);
 *   2. populates config.wireguard.{server,client}PublicKey from the generated or
 *      persisted keys (unless an operator pinned them) so request-time config/QR
 *      issuance advertises the correct server public key;
 *   3. enables IPv4 forwarding so wg-clients traffic can route out via wg-fireisp;
 *   4. installs the base nftables ruleset (ensureBaseFirewall).
 *
 * Each interface is provisioned independently and idempotently; a failure on one
 * (or on ip_forward / the firewall) is logged and does NOT abort the rest, and
 * the caller (server.js) also wraps this in try/catch — so a host that lacks
 * CAP_NET_ADMIN logs a warning and the API still starts in config-issuance mode.
 *
 * @returns {Promise<{applied:boolean, reason?:string}>}
 */
async function bootstrapHost() {
  if (!config.wireguard.serverEnabled) return { ...NOOP_RESULT };

  const keyDir = config.wireguard.keyDir;
  try {
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    logger.warn({ keyDir, err: err.message }, 'wireguardServerService: mkdir keyDir failed (non-fatal)');
  }

  // Provision each interface independently — a hard failure on one is logged and
  // must not abort the other interface, ip_forward, or the firewall.
  let serverPub;
  try {
    serverPub = await ensureInterface({
      iface:      config.wireguard.serverInterface,
      subnet:     config.wireguard.serverSubnet,
      listenPort: config.wireguard.serverListenPort,
    });
  } catch (err) {
    logger.warn({ iface: config.wireguard.serverInterface, err: err.message }, 'wireguardServerService: server interface bring-up failed (non-fatal)');
  }
  let clientPub;
  try {
    clientPub = await ensureInterface({
      iface:      config.wireguard.clientInterface,
      subnet:     config.wireguard.clientSubnet,
      listenPort: config.wireguard.clientListenPort,
    });
  } catch (err) {
    logger.warn({ iface: config.wireguard.clientInterface, err: err.message }, 'wireguardServerService: client interface bring-up failed (non-fatal)');
  }

  // Adopt the key each interface is actually bound to (warns on a pin mismatch).
  reconcilePublicKey('serverPublicKey', 'WG_SERVER_PUBLIC_KEY', serverPub, config.wireguard.serverInterface);
  reconcilePublicKey('clientPublicKey', 'WG_CLIENT_SERVER_PUBLIC_KEY', clientPub, config.wireguard.clientInterface);

  // Enable IPv4 forwarding so wg-clients → wg-fireisp routing works. Write /proc
  // directly (there's no `sysctl` binary in the slim image). Best-effort:
  // docker-compose.prod.yml also sets this via sysctls, and a locked-down host may
  // refuse the write — neither should abort startup.
  try {
    fs.writeFileSync('/proc/sys/net/ipv4/ip_forward', '1');
  } catch (err) {
    logger.warn({ err: err.message }, 'wireguardServerService: enable ip_forward failed (non-fatal)');
  }

  // Install the base nftables ruleset (idempotent; no-op when already present).
  try {
    await ensureBaseFirewall();
  } catch (err) {
    logger.warn({ err: err.message }, 'wireguardServerService: ensureBaseFirewall failed (non-fatal)');
  }

  logger.info(
    {
      serverInterface: config.wireguard.serverInterface,
      clientInterface: config.wireguard.clientInterface,
    },
    'wireguardServerService: host bootstrap complete',
  );
  return { applied: true };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  // Part 1 — NAS tunnels (wg-fireisp)
  generateKeypair,
  allocateTunnelIp,
  syncPeer,
  removePeer,

  // Part 2 — user access tunnels (wg-clients)
  allocateUserTunnelIp,
  syncUserPeer,
  readPeerHandshakes,
  ensureBaseFirewall,
  setUserForwardScope,
  removeUserPeer,

  // Host bootstrap (startup)
  bootstrapHost,
};
