// =============================================================================
// FireISP 5.0 — WireGuard Provisioning Service (per-NAS, Part 1)
// =============================================================================
// Orchestrates the per-NAS WireGuard tunnel lifecycle:
//   provisionDesiredState  DB + host-side sync only (no router I/O). Idempotent.
//   bootstrap              Try RouterOS API → on reachability fail, return snippet.
//   discoverSubnets        Read connected subnets from the router (read-only).
//   confirmRoutes          Commit confirmed CIDRs; re-sync host peer + user scopes.
//   buildSnippet           Generate paste-once RouterOS CLI (WG-only writes).
//
// HARD CONSTRAINT: this service NEVER writes /ip/service or /ip/firewall on the
// router. The only allowed RouterOS writes are: /interface/wireguard,
// /ip/address, /interface/wireguard/peers (done via routerosService helpers).
//
// Mirror of routerProvisioningService.js: reuses nasToConn, emits steps[].
// RouterOS 7 native /interface/wireguard only — no v6 fallbacks.
// =============================================================================

'use strict';

const ros = require('./routerosService');
const wg = require('./wireguardServerService');
const { nasToConn } = require('./routerProvisioningService');
const NasWgTunnel = require('../models/NasWgTunnel');
const { encrypt, decrypt } = require('../utils/encryption');
const { ValidationError } = require('../utils/errors');
const config = require('../config');
const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'wgProvisioningService' });

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Safely parse a MySQL JSON column value that may arrive as a string or already
 * as an array (mysql2 auto-parses JSON columns in some configurations).
 *
 * @param {string|any[]|null} value
 * @param {any} fallback
 * @returns {any}
 */
function parseJsonField(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }
  return value;
}

/**
 * Convert a dotted-quad IPv4 string to an unsigned 32-bit integer.
 * @param {string} ip
 * @returns {number}
 */
function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/**
 * Test whether a CIDR block contains a given IP address.
 * @param {string} cidr  e.g. '192.168.1.0/24'
 * @param {string} ip    e.g. '192.168.1.5'
 * @returns {boolean}
 */
function subnetContainsIp(cidr, ip) {
  const [netIp, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  // /0 means any IP; avoid the UB of <<32
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipToInt(netIp) & mask) === (ipToInt(ip) & mask);
}

/**
 * Test whether two CIDR blocks overlap (one is a subset/superset of the other
 * or they share any host addresses). Uses the common network-address comparison
 * at the shorter of the two prefix lengths.
 *
 * @param {string} cidrA
 * @param {string} cidrB
 * @returns {boolean}
 */
function overlapsSubnet(cidrA, cidrB) {
  const [ipA, prefA] = cidrA.split('/');
  const [ipB, prefB] = cidrB.split('/');
  const minPrefix = Math.min(parseInt(prefA, 10), parseInt(prefB, 10));
  const mask = minPrefix === 0 ? 0 : (~0 << (32 - minPrefix)) >>> 0;
  return (ipToInt(ipA) & mask) === (ipToInt(ipB) & mask);
}

/**
 * Assemble a paste-once RouterOS CLI snippet from pre-resolved tunnel fields.
 * SECURITY: privateKey appears in the snippet (needed for NAS config) but is
 * NEVER emitted to the application logger.
 *
 * @param {{ id: number, interface_name: string, tunnel_address: string }} tunnel
 * @param {{ endpoint: string, port: number, publicKey: string,
 *            subnet: string, keepalive: number }} serverCfg
 * @param {string[]} subnets  Confirmed routed CIDRs (may be empty)
 * @param {string} privateKey Plaintext NAS private key (decrypted from DB)
 * @returns {string}
 */
function assembleSnippet(tunnel, serverCfg, subnets, privateKey) {
  const ifaceName = tunnel.interface_name || `fireisp-nas-${tunnel.id}`;
  const tunnelIp  = tunnel.tunnel_address;

  const lines = [
    '# =================================================================',
    '# FireISP WireGuard — paste-once RouterOS CLI bootstrap',
    '# IMPORTANT: only /interface/wireguard, /ip/address, and routes are',
    '# written. Winbox (port 8291), /ip/service, and /ip/firewall are',
    '# NOT touched.',
    '# =================================================================',
    '',
    '# 1. Create the WireGuard interface (NAS dials out — no listen-port)',
    `/interface/wireguard/add name=${ifaceName} private-key=${privateKey} comment=fireisp-server`,
    '',
    '# 2. Assign the tunnel /32 address',
    `/ip/address/add interface=${ifaceName} address=${tunnelIp}/32`,
    '',
    '# 3. Add the FireISP hub as a peer (NAS dials out)',
    `/interface/wireguard/peers/add interface=${ifaceName} \\`,
    `  public-key=${serverCfg.publicKey} \\`,
    `  endpoint-address=${serverCfg.endpoint} \\`,
    `  endpoint-port=${serverCfg.port} \\`,
    `  allowed-address=${serverCfg.subnet} \\`,
    `  persistent-keepalive=${serverCfg.keepalive} \\`,
    '  comment=fireisp-server',
  ];

  // 4. Return route — RouterOS 7 does NOT auto-create routes from a peer's
  // allowed-address, so the NAS must have an explicit route for the FireISP hub
  // subnet back via the WireGuard interface. Without this, reply traffic from the
  // NAS to the hub's masqueraded source (10.255.0.1) exits via the WAN and is lost.
  lines.push('');
  lines.push('# 4. Return route — NAS must route the FireISP hub subnet via the WG interface');
  lines.push(`/ip/route/add dst-address=${serverCfg.subnet} gateway=${ifaceName} comment=fireisp-hub-return`);

  if (subnets && subnets.length > 0) {
    lines.push('');
    lines.push('# 5. Routes for confirmed device subnets');
    for (const subnet of subnets) {
      lines.push(`/ip/route/add dst-address=${subnet} gateway=${ifaceName}`);
    }
  }

  return lines.join('\n');
}

// =============================================================================
// Load tunnel for a NAS (shared by multiple fns)
// =============================================================================

/**
 * @param {number} nasId
 * @returns {Promise<object|null>}
 */
async function loadTunnel(nasId) {
  const [rows] = await db.query(
    'SELECT * FROM nas_wg_tunnels WHERE nas_id = ? AND deleted_at IS NULL LIMIT 1',
    [nasId],
  );
  return rows[0] || null;
}

// =============================================================================
// provisionDesiredState
// =============================================================================

/**
 * Ensure the DB record and host-side WG peer exist for a NAS.
 *
 * DB + local-host only — no RouterOS API calls. Safe to call at any time,
 * including when the router is offline. Idempotent: if a live tunnel record
 * already exists, the existing keypair and tunnel IP are reused.
 *
 * @param {object} nas  NAS row from `nas` table
 * @param {object} [opts]
 * @param {string} [opts.preallocatedTunnelIp]  When provided, use this tunnel IP
 *   instead of calling allocateTunnelIp(). Used for NATed NAS creates where the
 *   tunnel IP was pre-allocated and written to nas.ip_address before insert.
 * @returns {Promise<{ tunnel: object, steps: Array<{step,status,detail}> }>}
 */
async function provisionDesiredState(nas, opts = {}) {
  const steps = [];
  const record = (step, status, detail) => steps.push({ step, status, detail });
  const { preallocatedTunnelIp } = opts;

  let tunnel = await loadTunnel(nas.id);

  if (tunnel) {
    // Reuse existing record — idempotent
    record('keypair', 'exists', `Reusing keypair for tunnel IP ${tunnel.tunnel_address}`);
  } else {
    // Generate keypair and allocate tunnel IP.
    // For NATed NAS creates, the tunnel IP was pre-allocated by the route handler
    // (and written to nas.ip_address) — reuse it here so ip_address == tunnel_address.
    const { privateKey, publicKey } = wg.generateKeypair();
    // For a NATed NAS, ip_address IS its tunnel address (assigned at create). On the
    // deferred/bootstrap path preallocatedTunnelIp is absent, so reuse ip_address
    // instead of allocating a fresh one — otherwise tunnel_address would drift from
    // ip_address and break the RADIUS/RouterOS-API host. A direct NAS (ip_address =
    // the real device IP) always allocates a separate tunnel IP.
    const tunnelIp = preallocatedTunnelIp
      || (nas.access_mode === 'nated' && nas.ip_address ? nas.ip_address : await wg.allocateTunnelIp());

    const tunnelData = {
      organization_id: nas.organization_id || null,
      nas_id: nas.id,
      interface_name: `fireisp-nas-${nas.id}`,
      tunnel_address: tunnelIp,
      nas_public_key: publicKey,
      nas_private_key_encrypted: encrypt(privateKey),
      nas_config_method: 'manual',
      routed_subnets: JSON.stringify([]),
      state: 'pending',
      server_peer_synced: 0,
    };

    tunnel = await NasWgTunnel.create(tunnelData);
    // SECURITY: privateKey is NOT logged.
    record('keypair', 'created', `Keypair generated; tunnel IP ${tunnelIp}`);
  }

  // Sync host-side peer (/32 only; subnets are added later via confirmRoutes)
  const subnets = parseJsonField(tunnel.routed_subnets, []);
  const syncResult = await wg.syncPeer({
    publicKey: tunnel.nas_public_key,
    tunnelIp: tunnel.tunnel_address,
    subnets,
  });

  if (syncResult.applied) {
    await db.query(
      'UPDATE nas_wg_tunnels SET server_peer_synced = 1 WHERE id = ?',
      [tunnel.id],
    );
    record('syncPeer', 'ok', `Host wg-fireisp peer synced for ${tunnel.tunnel_address}/32`);
  } else {
    record('syncPeer', 'skipped', syncResult.reason || 'WG_SERVER_ENABLED is false');
  }

  logger.info(
    { nasId: nas.id, tunnelId: tunnel.id, tunnelIp: tunnel.tunnel_address },
    'wgProvisioningService: provisionDesiredState complete',
  );
  return { tunnel, steps };
}

// =============================================================================
// bootstrap
// =============================================================================

/**
 * Bootstrap the WireGuard tunnel on the router via the RouterOS API.
 *
 * Tries three ordered API writes (interface → address → peer). Error handling:
 *   • routerUnreachable → no throw; returns { method:'snippet', snippet, steps }
 *     with HTTP-200 semantics — the caller must surface the snippet to the admin.
 *     DB state is set to method='snippet', state='manual'.
 *   • routerAuthFailed / ValidationError → propagate (422 at the route layer).
 *   • Any other error propagates; the route maps unknown errors to 502.
 *
 * Idempotent: re-running applies the same RouterOS commands (upsert by name/comment).
 *
 * @param {object} nas  NAS row (must have api_username + api_password_encrypted)
 * @returns {Promise<{ method: 'api'|'snippet', snippet?: string,
 *                     steps: Array<{step,status,detail}>, tunnel?: object }>}
 */
async function bootstrap(nas) {
  const steps = [];

  // Ensure a tunnel record exists before touching the router
  let tunnel = await loadTunnel(nas.id);
  if (!tunnel) {
    const provisioned = await provisionDesiredState(nas);
    tunnel = provisioned.tunnel;
    steps.push(...provisioned.steps);
  }

  const ifaceName  = tunnel.interface_name || `fireisp-nas-${nas.id}`;
  const tunnelIp   = tunnel.tunnel_address;
  // SECURITY: privateKey is decrypted for use in RouterOS API calls and the
  // snippet body but is NEVER logged.
  const privateKey = decrypt(tunnel.nas_private_key_encrypted);
  const subnets    = parseJsonField(tunnel.routed_subnets, []);

  const serverCfg = {
    endpoint:  config.wireguard.serverEndpoint,
    port:      config.wireguard.serverListenPort,
    publicKey: config.wireguard.serverPublicKey,
    subnet:    config.wireguard.serverSubnet,
    keepalive: config.wireguard.keepalive,
  };

  const conn = nasToConn(nas);

  try {
    // ── 1. WireGuard interface (NAS dials out — no listen-port) ──────────────
    const ifaceRes = await ros.wireguardInterfaceUpsert(conn, {
      name:       ifaceName,
      privateKey,
      comment:    'fireisp-server',
    });
    steps.push({
      step:   'interface',
      status: ifaceRes.created ? 'created' : 'updated',
      detail: `WireGuard interface ${ifaceName}`,
    });

    // ── 2. Tunnel /32 address ─────────────────────────────────────────────────
    const addrRes = await ros.wireguardAddressUpsert(conn, {
      interface: ifaceName,
      address:   `${tunnelIp}/32`,
    });
    steps.push({
      step:   'address',
      status: addrRes.created ? 'created' : 'updated',
      detail: `IP address ${tunnelIp}/32 on ${ifaceName}`,
    });

    // ── 3. Server peer (stable comment survives key rotation) ─────────────────
    const peerRes = await ros.wireguardPeerUpsert(conn, {
      interface:       ifaceName,
      publicKey:       serverCfg.publicKey,
      endpointAddress: serverCfg.endpoint,
      endpointPort:    serverCfg.port,
      allowedAddress:  serverCfg.subnet,
      keepalive:       serverCfg.keepalive,
      comment:         'fireisp-server',
    });
    steps.push({
      step:   'peer',
      status: peerRes.created ? 'created' : 'updated',
      detail: `Server peer ${serverCfg.endpoint}:${serverCfg.port}`,
    });

    // ── 4. Return route (RouterOS 7 does not auto-create routes from peer allowed-address) ─
    const routeRes = await ros.wireguardRouteUpsert(conn, {
      dstAddress: serverCfg.subnet,
      gateway:    ifaceName,
      comment:    'fireisp-hub-return',
    });
    steps.push({
      step:   'return-route',
      status: routeRes.created ? 'created' : 'exists',
      detail: `Return route ${serverCfg.subnet} via ${ifaceName}`,
    });

    // ── Persist success ───────────────────────────────────────────────────────
    await db.query(
      'UPDATE nas_wg_tunnels SET nas_config_method = ?, state = ?, provisioned_at = NOW(), last_error = NULL WHERE id = ?',
      ['api', 'active', tunnel.id],
    );
    steps.push({ step: 'state', status: 'active', detail: 'NAS configured via RouterOS API' });

    logger.info(
      { nasId: nas.id, tunnelId: tunnel.id, tunnelIp },
      'wgProvisioningService: bootstrap via API succeeded',
    );
    return {
      method: 'api',
      steps,
      tunnel: { ...tunnel, state: 'active', nas_config_method: 'api' },
    };

  } catch (err) {
    // ── routerUnreachable → snippet mode, HTTP-200 ────────────────────────────
    if (err && err.routerUnreachable) {
      const snippet = assembleSnippet(tunnel, serverCfg, subnets, privateKey);

      await db.query(
        'UPDATE nas_wg_tunnels SET nas_config_method = ?, state = ?, last_error = ? WHERE id = ?',
        ['snippet', 'manual', (err.message || '').slice(0, 1000), tunnel.id],
      );
      steps.push({ step: 'reachability', status: 'unreachable', detail: err.message });

      logger.info({ nasId: nas.id }, 'wgProvisioningService: router unreachable — returning snippet (HTTP 200)');
      return { method: 'snippet', snippet, steps };
    }

    // routerAuthFailed / ValidationError → propagate so the route can 422
    throw err;
  }
}

// =============================================================================
// discoverSubnets
// =============================================================================

/**
 * Read the connected subnets from the router and propose CIDRs to route.
 *
 * Makes a read-only RouterOS topology query, then excludes:
 *   - The WireGuard server subnet (10.255.0.0/16 or WG_SERVER_SUBNET)
 *   - Any subnet whose CIDR contains the NAS's own management/WAN IP
 *     (prevents routing the router's uplink through itself)
 *
 * Propagates connection errors so the caller can map them to 502/422.
 *
 * @param {object} nas
 * @returns {Promise<{ proposed: string[], topology: object }>}
 */
async function discoverSubnets(nas) {
  const conn = nasToConn(nas);
  const topology = await ros.wireguardReadTopology(conn);

  const wgSubnet = config.wireguard.serverSubnet;
  const nasIp    = nas.ip_address;
  const proposed = [];

  for (const route of topology.routes) {
    const prefix = route['dst-address'] || '';
    if (!prefix || !prefix.includes('/')) continue;

    // Skip single-host routes (/32 IPv4, /128 IPv6) and malformed masks. A host
    // route is never a LAN "behind the NAS" — e.g. a cloud router's WAN gateway
    // link-route (203.0.113.1/32) is connected but must not be proposed as a site
    // subnet. Real customer LANs are always a prefix wider than a single host.
    const maskBits = parseInt(prefix.split('/')[1], 10);
    if (!Number.isFinite(maskBits) || maskBits === 32 || maskBits === 128) continue;

    // Exclude the WireGuard server tunnel pool
    if (overlapsSubnet(prefix, wgSubnet)) continue;

    // Exclude the subnet that directly contains the NAS management IP
    // (the NAS's uplink/WAN side — it must not be routed back through itself)
    if (nasIp && subnetContainsIp(prefix, nasIp)) continue;

    proposed.push(prefix);
  }

  logger.info({ nasId: nas.id, proposed: proposed.length }, 'wgProvisioningService: discoverSubnets complete');
  return { proposed, topology };
}

// =============================================================================
// confirmRoutes
// =============================================================================

/**
 * Commit confirmed subnets, re-sync the host-side peer, and refresh user scopes.
 *
 * Stores `subnets` in `nas_wg_tunnels.routed_subnets`, calls syncPeer with
 * [tunnelIp/32, ...subnets], and emits a warning step for any CIDR that already
 * appears in another live tunnel's routed_subnets (per-NAS source routing is a
 * FOLLOW-UP; overlapping on wg-fireisp will break routing for one of them).
 *
 * Also calls `userTunnelService.refreshAffectedByNas(nas.id)` so live user
 * scopes track the route change. The userTunnelService require is lazy (it
 * belongs to another task) — failure is non-fatal.
 *
 * @param {object} nas
 * @param {{ subnets: string[] }} body
 * @returns {Promise<{ steps: Array<{step,status,detail}>, tunnel: object }>}
 */
async function confirmRoutes(nas, { subnets }) {
  const steps = [];
  const record = (step, status, detail) => steps.push({ step, status, detail });

  if (!Array.isArray(subnets)) {
    throw new ValidationError('subnets must be an array of CIDR strings');
  }

  const tunnel = await loadTunnel(nas.id);
  if (!tunnel) {
    throw new ValidationError('No WireGuard tunnel found for this NAS — call bootstrap first');
  }

  // ── Overlap guard (MVP: warn, do not block) ────────────────────────────────
  if (subnets.length > 0) {
    const [otherTunnels] = await db.query(
      'SELECT id, nas_id, routed_subnets FROM nas_wg_tunnels WHERE id != ? AND deleted_at IS NULL AND routed_subnets IS NOT NULL',
      [tunnel.id],
    );
    const warnings = [];
    for (const other of otherTunnels) {
      const otherSubnets = parseJsonField(other.routed_subnets, []);
      const overlap = subnets.filter((s) => otherSubnets.includes(s));
      if (overlap.length) {
        warnings.push(
          `CIDRs [${overlap.join(', ')}] already routed by tunnel ${other.id} (NAS ${other.nas_id})`,
        );
      }
    }
    if (warnings.length) {
      record('overlap-check', 'warning',
        `Potential route collision on wg-fireisp: ${warnings.join('; ')}. ` +
        'Per-NAS source routing is a FOLLOW-UP; resolve before confirming.',
      );
    } else {
      record('overlap-check', 'ok', 'No overlapping subnets in other tunnels');
    }
  } else {
    record('overlap-check', 'skipped', 'No subnets to check');
  }

  // ── Persist confirmed subnets ──────────────────────────────────────────────
  await db.query(
    'UPDATE nas_wg_tunnels SET routed_subnets = ?, updated_at = NOW() WHERE id = ?',
    [JSON.stringify(subnets), tunnel.id],
  );
  record('store-subnets', 'ok', `Stored ${subnets.length} subnet(s) in nas_wg_tunnels`);

  // ── Re-sync host-side peer (tunnelIp/32 + all confirmed subnets) ───────────
  const syncResult = await wg.syncPeer({
    publicKey: tunnel.nas_public_key,
    tunnelIp:  tunnel.tunnel_address,
    subnets,
  });
  if (syncResult.applied) {
    await db.query(
      'UPDATE nas_wg_tunnels SET server_peer_synced = 1 WHERE id = ?',
      [tunnel.id],
    );
    record('syncPeer', 'ok', `Host wg-fireisp peer updated with ${subnets.length} subnet(s)`);
  } else {
    record('syncPeer', 'skipped', syncResult.reason || 'WG_SERVER_ENABLED is false');
  }

  // ── Refresh affected user tunnel scopes ────────────────────────────────────
  // Lazy require: userTunnelService belongs to a parallel task.
  // Non-fatal — user scopes will be stale until that service is deployed.
  try {
    const userTunnelService = require('./userTunnelService');
    await userTunnelService.refreshAffectedByNas(nas.id);
    record('user-scopes', 'ok', 'Affected user tunnel scopes refreshed');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      record('user-scopes', 'skipped', 'userTunnelService not yet deployed');
    } else {
      logger.warn(
        { nasId: nas.id, err: err.message },
        'confirmRoutes: refreshAffectedByNas failed (non-fatal)',
      );
      record('user-scopes', 'warning', `refreshAffectedByNas failed: ${err.message}`);
    }
  }

  logger.info(
    { nasId: nas.id, tunnelId: tunnel.id, subnetCount: subnets.length },
    'wgProvisioningService: confirmRoutes complete',
  );
  return { steps, tunnel: { ...tunnel, routed_subnets: subnets } };
}

// =============================================================================
// buildSnippet (exported public API)
// =============================================================================

/**
 * Generate the paste-once RouterOS CLI bootstrap snippet for a NAS.
 *
 * Fetches the tunnel record from DB (decrypts private key) and renders a
 * deterministic sequence of RouterOS CLI commands. WireGuard-only: only
 * /interface/wireguard, /ip/address, and /ip/route writes are emitted.
 *
 * HARD CONSTRAINT: does NOT emit /ip/service or /ip/firewall commands.
 * Winbox (port 8291) is NOT touched.
 *
 * SECURITY: privateKey appears in the returned string (the admin pastes it
 * into the router terminal) but is NEVER written to the application logger.
 *
 * @param {object} nas
 * @param {{ endpoint: string, port: number, publicKey: string,
 *            subnet: string, keepalive: number }} serverCfg
 * @param {string[]} subnets  CIDRs to include as /ip/route entries (may be [])
 * @returns {Promise<string>}
 */
async function buildSnippet(nas, serverCfg, subnets) {
  const tunnel = await loadTunnel(nas.id);
  if (!tunnel) {
    throw new ValidationError(
      'No WireGuard tunnel found for this NAS — call provisionDesiredState (or bootstrap) first',
    );
  }
  const privateKey = decrypt(tunnel.nas_private_key_encrypted);
  return assembleSnippet(tunnel, serverCfg, subnets || [], privateKey);
}

// =============================================================================
// rehydrateNasPeers
// =============================================================================

/**
 * Re-add every live NAS hub peer to wg-fireisp from the database.
 *
 * A NAS peer and its routes live ONLY in the wg-fireisp interface's runtime
 * kernel state, which is wiped whenever the hub container restarts.
 * `wireguardServerService.bootstrapHost()` recreates the interfaces but NOT the
 * per-NAS peers, so without this step every site tunnel would stay down after a
 * restart until its routes were manually re-confirmed. Call once at startup
 * (server.js), right after bootstrapHost().
 *
 * Idempotent: `syncPeer` issues `wg set … peer` + `ip route replace`, both of
 * which converge rather than duplicate, so running on every boot is safe even
 * when nothing was lost. Per-row best-effort — a single bad tunnel is logged and
 * never aborts the rest. No-op unless WG_SERVER_ENABLED=true.
 *
 * Restores every live tunnel regardless of state ('pending'/'active'/'manual'):
 * the server-side peer is added at provision time for all of them, so a faithful
 * restore re-adds them all ('pending' tunnels simply carry no routed subnets
 * yet). "Live" means the tunnel row is not soft-deleted AND its parent NAS is
 * not soft-deleted: a NAS soft-delete does NOT cascade to its tunnel row (the FK
 * cascades only on a hard DELETE), so without the nas join a restart would
 * resurrect kernel peers + routes for a deleted NAS — and could hijack a CIDR
 * that has since been reassigned to a live NAS. (nas_public_key/tunnel_address
 * are NOT NULL in the schema, so no null guard is needed.)
 *
 * @returns {Promise<{ rehydrated: number, total: number, skipped?: boolean }>}
 */
async function rehydrateNasPeers() {
  if (!config.wireguard.serverEnabled) {
    return { rehydrated: 0, total: 0, skipped: true };
  }

  const [tunnels] = await db.query(
    `SELECT t.id, t.nas_public_key, t.tunnel_address, t.routed_subnets
       FROM nas_wg_tunnels t
       JOIN nas n ON n.id = t.nas_id AND n.deleted_at IS NULL
      WHERE t.deleted_at IS NULL`,
  );

  let rehydrated = 0;
  for (const tunnel of tunnels) {
    try {
      const subnets = parseJsonField(tunnel.routed_subnets, []);
      await wg.syncPeer({
        publicKey: tunnel.nas_public_key,
        tunnelIp:  tunnel.tunnel_address,
        subnets,
      });
      rehydrated += 1;
    } catch (err) {
      logger.warn(
        { tunnelId: tunnel.id, err: err.message },
        'rehydrateNasPeers: syncPeer failed (non-fatal)',
      );
    }
  }

  logger.info(
    { rehydrated, total: tunnels.length },
    'rehydrateNasPeers: NAS hub peers restored from DB',
  );
  return { rehydrated, total: tunnels.length };
}

// =============================================================================
// teardownNas
// =============================================================================

/**
 * Tear down a NAS's WireGuard tunnel when the NAS is deleted.
 *
 * A NAS soft-delete does NOT cascade to nas_wg_tunnels (the FK cascades only on
 * a hard DELETE), so without this the hub peer + its kernel routes would linger
 * — and rehydrateNasPeers would otherwise resurrect them on the next restart.
 * Called from the /nas DELETE route (crudController afterDelete hook).
 *
 * For each live tunnel of the NAS: removes the hub peer + its routes
 * (`removePeer`, a no-op when WG_SERVER_ENABLED=false), soft-deletes the tunnel
 * row, then recomputes scope for affected users so the now-gone subnets drop out
 * of their nftables ACL. Best-effort throughout — the NAS delete itself must not
 * fail because a hub op did.
 *
 * @param {number} nasId
 * @returns {Promise<{ tornDown: number }>}
 */
async function teardownNas(nasId) {
  const [tunnels] = await db.query(
    'SELECT id, nas_public_key, tunnel_address, routed_subnets FROM nas_wg_tunnels WHERE nas_id = ? AND deleted_at IS NULL',
    [nasId],
  );
  if (!tunnels.length) return { tornDown: 0 };

  let tornDown = 0;
  for (const tunnel of tunnels) {
    const subnets = parseJsonField(tunnel.routed_subnets, []);
    // Remove the hub peer + every route it owns (its /32 plus routed subnets).
    try {
      await wg.removePeer({
        publicKey: tunnel.nas_public_key,
        subnets: [`${tunnel.tunnel_address}/32`, ...subnets],
      });
    } catch (err) {
      logger.warn(
        { tunnelId: tunnel.id, err: err.message },
        'teardownNas: removePeer failed (non-fatal)',
      );
    }
    // Soft-delete the tunnel row so it is never rehydrated.
    await db.query(
      'UPDATE nas_wg_tunnels SET deleted_at = NOW(), updated_at = NOW() WHERE id = ?',
      [tunnel.id],
    );
    tornDown += 1;
  }

  // Recompute scope for users who were reaching this NAS so its subnets are
  // dropped from their nftables ACL now (not just on the next refresh/restart).
  try {
    const userTunnelService = require('./userTunnelService');
    await userTunnelService.refreshAffectedByNas(nasId);
  } catch (err) {
    logger.warn({ nasId, err: err.message }, 'teardownNas: refreshAffectedByNas failed (non-fatal)');
  }

  logger.info({ nasId, tornDown }, 'teardownNas: NAS WireGuard tunnel torn down on delete');
  return { tornDown };
}

// =============================================================================
// restoreNas
// =============================================================================

/**
 * Revive the WireGuard tunnel teardownNas soft-deleted, when the NAS is restored.
 *
 * The inverse of teardownNas: un-soft-deletes the most recently torn-down tunnel
 * row for the NAS and re-adds the hub peer + routes with the SAME keypair, so the
 * site tunnel comes back without a router reconfig (teardown only ever touched
 * the hub side, never the router). Called from the /nas restore route
 * (crudController afterRestore hook).
 *
 * No-op when a live tunnel already exists for the NAS (e.g. it was re-provisioned
 * by a re-add-by-IP in the meantime) or when there is nothing to revive. Re-sync
 * is a no-op when WG_SERVER_ENABLED=false. Best-effort — restore must not fail
 * because a hub op did.
 *
 * @param {number} nasId
 * @returns {Promise<{ restored: number }>}
 */
async function restoreNas(nasId) {
  // If a live tunnel already exists (re-added by IP in the meantime), the old
  // soft-deleted row must stay archived — reviving it would collide on the
  // (nas_id, active_flag) / (tunnel_address, active_flag) unique keys.
  const [live] = await db.query(
    'SELECT id FROM nas_wg_tunnels WHERE nas_id = ? AND deleted_at IS NULL LIMIT 1',
    [nasId],
  );
  if (live.length) return { restored: 0 };

  // Find the most recently torn-down tunnel for this NAS.
  const [rows] = await db.query(
    `SELECT id, nas_public_key, tunnel_address, routed_subnets
       FROM nas_wg_tunnels
      WHERE nas_id = ? AND deleted_at IS NOT NULL
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [nasId],
  );
  if (!rows.length) return { restored: 0 };
  const tunnel = rows[0];

  // Un-soft-delete the original row (keeps id / keypair / tunnel IP).
  await db.query(
    'UPDATE nas_wg_tunnels SET deleted_at = NULL, updated_at = NOW() WHERE id = ?',
    [tunnel.id],
  );

  // Re-add the hub peer + its routes (no-op when WG disabled).
  try {
    const subnets = parseJsonField(tunnel.routed_subnets, []);
    await wg.syncPeer({
      publicKey: tunnel.nas_public_key,
      tunnelIp:  tunnel.tunnel_address,
      subnets,
    });
  } catch (err) {
    logger.warn({ tunnelId: tunnel.id, err: err.message }, 'restoreNas: syncPeer failed (non-fatal)');
  }

  // Re-add this NAS's subnets back into affected users' scope.
  try {
    const userTunnelService = require('./userTunnelService');
    await userTunnelService.refreshAffectedByNas(nasId);
  } catch (err) {
    logger.warn({ nasId, err: err.message }, 'restoreNas: refreshAffectedByNas failed (non-fatal)');
  }

  logger.info({ nasId, tunnelId: tunnel.id }, 'restoreNas: NAS WireGuard tunnel revived on restore');
  return { restored: 1 };
}

// =============================================================================
// Exports
// =============================================================================

module.exports = {
  provisionDesiredState,
  bootstrap,
  discoverSubnets,
  confirmRoutes,
  buildSnippet,
  rehydrateNasPeers,
  teardownNas,
  restoreNas,
};
