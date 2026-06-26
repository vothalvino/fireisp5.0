// =============================================================================
// FireISP 5.0 — User Tunnel Service (§6b / §6e)
// =============================================================================
// Orchestrates the full lifecycle of user-access WireGuard peers:
//   createPeer   — generate keypair, allocate IP, write DB, sync hub
//   rotatePeer   — replace keypair, re-sync hub; admin never sees private key
//   revokePeer   — remove kernel peer + nft state, soft-delete DB row
//   refreshUserPeers     — recompute a user's scope, re-sync all their peers
//   refreshAffectedByNas — find all users affected by a NAS route change
//   buildConfig  — produce the WireGuard .conf text for a peer
//   buildQr      — render the .conf as an SVG QR code (server-side; qrcode pkg)
//
// SECURITY invariants:
//   - Private and preshared keys are NEVER logged.
//   - encrypt() is called from src/utils/encryption.js (AES-256-GCM).
//   - Private key is returned only on createPeer (to the owner) and via the
//     /config download endpoint — redactPeer() in the route strips it elsewhere.
//   - Server private keys live in /etc/wireguard/*.conf; they never enter the DB.
// =============================================================================

'use strict';

const QRCode = require('qrcode');

const db = require('../config/database');
const config = require('../config');
const { encrypt } = require('../utils/encryption');
const { NotFoundError } = require('../utils/errors');
const auditLog = require('./auditLog');
const userTunnelScopeService = require('./userTunnelScopeService');
const wireguardServerService = require('./wireguardServerService');
const logger = require('../utils/logger').child({ service: 'userTunnelService' });

// =============================================================================
// Config helpers
// =============================================================================

/**
 * Build a WireGuard .conf file for the user peer.
 *
 * The PresharedKey line is omitted when no PSK is set.
 * AllowedIPs uses the scoped subnets (routing convenience; the authoritative
 * ACL is the nftables FORWARD chain on the server).
 *
 * @param {object} peer          wg_user_peers row
 * @param {string} privateKey    plaintext private key (never log!)
 * @param {string[]} subnets     scoped CIDRs for AllowedIPs
 * @param {string|null} [presharedKey]  plaintext PSK (never log!)
 * @returns {string}
 */
function buildConfig(peer, privateKey, subnets, presharedKey = null) {
  const lines = [
    '[Interface]',
    `PrivateKey = ${privateKey}`,
    `Address    = ${peer.tunnel_address}/32`,
    '',
    '[Peer]',
    `PublicKey           = ${config.wireguard.clientPublicKey}`,
  ];
  if (presharedKey) {
    lines.push(`PresharedKey        = ${presharedKey}`);
  }
  lines.push(
    `Endpoint            = ${config.wireguard.serverEndpoint}:${config.wireguard.clientListenPort}`,
    `AllowedIPs          = ${subnets.length ? subnets.join(', ') : (peer.tunnel_address ? `${peer.tunnel_address}/32` : '127.0.0.1/32')}`,
    `PersistentKeepalive = ${config.wireguard.keepalive}`,
  );
  return lines.join('\n');
}

/**
 * Render a WireGuard .conf string as an SVG QR code.
 * The SVG can be inlined directly in the frontend (no canvas/canvas-size limit).
 *
 * @param {string} confText  output of buildConfig()
 * @returns {Promise<string>} SVG markup
 */
async function buildQr(confText) {
  return QRCode.toString(confText, { type: 'svg' });
}

// =============================================================================
// IP allocation helper
// =============================================================================

// =============================================================================
// Peer CRUD
// =============================================================================

/**
 * Create a new user peer: generate x25519 keypair, allocate tunnel IP, persist,
 * sync to the WireGuard hub, and return the .conf + QR SVG to the caller (the
 * only time the private key leaves the server for this peer).
 *
 * @param {number} userId
 * @param {number|null} orgId
 * @param {string|null} legacyRole   users.role value (for admin scope detection)
 * @param {string} name              user-supplied peer label ("Laptop", "Phone")
 * @returns {Promise<{peer:object, config:string, config_base64:string, qr_svg:string}>}
 */
async function createPeer(userId, orgId, legacyRole, name) {
  // 1. Compute the scope this user is allowed to reach
  const subnets = await userTunnelScopeService.getScopedSubnets(userId, orgId, legacyRole);

  // 2. Generate server-side x25519 keypair (never log privateKey)
  const { privateKey, publicKey } = wireguardServerService.generateKeypair();

  // 3. Allocate tunnel IP + insert DB row (retry on concurrent-dup)
  let peer;
  let tunnelIp;
  let lastInsertErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    tunnelIp = await wireguardServerService.allocateUserTunnelIp();
    try {
      const [result] = await db.query(
        `INSERT INTO wg_user_peers
           (organization_id, user_id, name, public_key, private_key_encrypted,
            tunnel_address, endpoint_host, server_peer_synced, allowed_ips_snapshot)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [
          orgId,
          userId,
          name,
          publicKey,
          encrypt(privateKey),          // NEVER log this value
          tunnelIp,
          config.wireguard.serverEndpoint || null,
          JSON.stringify(subnets),
        ],
      );
      const [[row]] = await db.query('SELECT * FROM wg_user_peers WHERE id = ?', [result.insertId]);
      peer = row;
      break;
    } catch (err) {
      lastInsertErr = err;
      if ((err.code === 'ER_DUP_ENTRY' || err.errno === 1062) && attempt < 2) continue;
      throw err;
    }
  }
  if (!peer) throw lastInsertErr;

  // 4. Sync to the WireGuard hub (best-effort; no-op when serverEnabled=false)
  try {
    await wireguardServerService.ensureBaseFirewall();
    await wireguardServerService.syncUserPeer({ publicKey, tunnelIp });
    await wireguardServerService.setUserForwardScope({
      peerId: peer.id,
      tunnelIp,
      subnets,
    });
    await db.query('UPDATE wg_user_peers SET server_peer_synced = 1 WHERE id = ?', [peer.id]);
    peer.server_peer_synced = 1;
  } catch (err) {
    logger.warn(
      { userId, peerId: peer.id, err: err.message },
      'createPeer: WireGuard hub sync failed (non-fatal when serverEnabled=false)',
    );
  }

  // 5. Audit — record tunnel_address + scope; NEVER include key material
  await auditLog.log({
    userId,
    organizationId: orgId,
    action: 'create',
    tableName: 'wg_user_peers',
    recordId: peer.id,
    newValues: {
      name,
      tunnel_address: tunnelIp,
      public_key: publicKey,
      scope_snapshot: subnets,
    },
  });

  // 6. Build .conf and QR (returned once to the owner — the only plaintext egress)
  const confText = buildConfig(peer, privateKey, subnets);
  const qr_svg = await buildQr(confText);

  return {
    peer,
    config: confText,
    config_base64: Buffer.from(confText).toString('base64'),
    qr_svg,
  };
}

/**
 * Replace the keypair for an existing peer (admin action).
 * The old public key is removed from the WireGuard kernel; the new one is added.
 * The new private key is stored encrypted — the admin NEVER sees it.
 * The peer owner re-downloads via GET /:id/config.
 *
 * @param {number} peerId
 * @param {number|null} orgId
 * @param {number} rotatedByUserId   for audit trail
 * @returns {Promise<object>} updated peer row (no key fields)
 */
async function rotatePeer(peerId, orgId, rotatedByUserId) {
  const [[peer]] = await db.query(
    'SELECT * FROM wg_user_peers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND revoked_at IS NULL',
    [peerId, orgId],
  );
  if (!peer) throw new NotFoundError('wg_user_peers');

  const oldPubKey = peer.public_key;
  const { privateKey: newPrivKey, publicKey: newPubKey } = wireguardServerService.generateKeypair();

  // Persist new keypair first so owner can re-download immediately
  await db.query(
    'UPDATE wg_user_peers SET public_key = ?, private_key_encrypted = ?, server_peer_synced = 0, updated_at = NOW() WHERE id = ?',
    [newPubKey, encrypt(newPrivKey), peer.id],    // NEVER log newPrivKey
  );

  // Recompute scope for firewall re-sync
  const [userRows] = await db.query(
    'SELECT organization_id, role FROM users WHERE id = ? AND deleted_at IS NULL',
    [peer.user_id],
  );
  const userRole = userRows[0]?.role || null;
  const subnets = await userTunnelScopeService.getScopedSubnets(peer.user_id, orgId, userRole);

  // Replace the WireGuard kernel peer (best-effort)
  try {
    // Remove old peer — also cleans nft state for this peerId
    await wireguardServerService.removeUserPeer({ publicKey: oldPubKey, peerId: peer.id });
    // Add new peer with same tunnel IP (still anti-spoof /32)
    await wireguardServerService.syncUserPeer({ publicKey: newPubKey, tunnelIp: peer.tunnel_address });
    // Re-install nft accept rule (removeUserPeer cleared it above)
    await wireguardServerService.setUserForwardScope({
      peerId: peer.id,
      tunnelIp: peer.tunnel_address,
      subnets,
    });
    await db.query('UPDATE wg_user_peers SET server_peer_synced = 1 WHERE id = ?', [peer.id]);
  } catch (err) {
    logger.warn(
      { peerId, err: err.message },
      'rotatePeer: WireGuard hub sync failed (non-fatal when serverEnabled=false)',
    );
  }

  // Audit — no key material in newValues
  await auditLog.log({
    userId: rotatedByUserId,
    organizationId: orgId,
    action: 'update',
    tableName: 'wg_user_peers',
    recordId: peer.id,
    newValues: { rotated: true, new_public_key: newPubKey },
  });

  const [[updated]] = await db.query('SELECT * FROM wg_user_peers WHERE id = ?', [peer.id]);
  return updated;
}

/**
 * Revoke a peer: remove from WireGuard kernel + nft, soft-delete DB row.
 * Effective on the next packet (WireGuard is connectionless — instant at the
 * data plane). `revokedBy` distinguishes self-revoke from admin action.
 *
 * @param {number} peerId
 * @param {number|null} orgId
 * @param {number|null} revokedBy   user id of the caller (null = system)
 * @returns {Promise<true>}
 */
async function revokePeer(peerId, orgId, revokedBy) {
  const [[peer]] = await db.query(
    'SELECT * FROM wg_user_peers WHERE id = ? AND organization_id = ? AND deleted_at IS NULL',
    [peerId, orgId],
  );
  if (!peer) throw new NotFoundError('wg_user_peers');

  // Remove from WireGuard (best-effort; non-fatal if hub is disabled)
  try {
    await wireguardServerService.removeUserPeer({ publicKey: peer.public_key, peerId: peer.id });
  } catch (err) {
    logger.warn({ peerId, err: err.message }, 'revokePeer: WireGuard hub remove failed (non-fatal)');
  }

  // Soft-delete + stamp revocation
  await db.query(
    'UPDATE wg_user_peers SET deleted_at = NOW(), revoked_at = NOW(), revoked_by = ?, server_peer_synced = 0 WHERE id = ?',
    [revokedBy || null, peer.id],
  );

  // Audit — only safe fields; no key material
  await auditLog.log({
    userId: revokedBy || peer.user_id,
    organizationId: orgId,
    action: 'delete',
    tableName: 'wg_user_peers',
    recordId: peer.id,
    oldValues: {
      tunnel_address: peer.tunnel_address,
      public_key: peer.public_key,
      revoked_by: revokedBy,
    },
  });

  return true;
}

// =============================================================================
// Scope refresh helpers
// =============================================================================

/**
 * Recompute the allowed-destination scope for all live peers belonging to a
 * user and push the updated nftables set + snapshot to each.
 *
 * Called on assignment change (admin PUT /assignments/:userId) and (FOLLOW-UP)
 * on role change. No-op if the user has no live peers.
 *
 * @param {number} userId
 * @returns {Promise<void>}
 */
async function refreshUserPeers(userId) {
  // Resolve the user's primary org + legacy role
  const [userRows] = await db.query(
    'SELECT id, organization_id, role FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );
  if (!userRows.length) return;
  const user = userRows[0];
  if (!user.organization_id) return;

  // Find all live, non-revoked peers for this user
  const [peers] = await db.query(
    'SELECT id, tunnel_address FROM wg_user_peers WHERE user_id = ? AND deleted_at IS NULL AND revoked_at IS NULL',
    [userId],
  );
  if (!peers.length) return;

  // Compute fresh scope
  const subnets = await userTunnelScopeService.getScopedSubnets(
    userId,
    user.organization_id,
    user.role,
  );
  const snapshotJson = JSON.stringify(subnets);

  for (const peer of peers) {
    // Push to WireGuard FORWARD chain (best-effort)
    try {
      await wireguardServerService.setUserForwardScope({
        peerId: peer.id,
        tunnelIp: peer.tunnel_address,
        subnets,
      });
    } catch (err) {
      logger.warn(
        { userId, peerId: peer.id, err: err.message },
        'refreshUserPeers: setUserForwardScope failed (non-fatal)',
      );
    }
    // Persist snapshot
    await db.query(
      'UPDATE wg_user_peers SET allowed_ips_snapshot = ? WHERE id = ?',
      [snapshotJson, peer.id],
    );
  }
}

/**
 * Recompute scope for every user whose VPN access touches a given NAS.
 * Called from `wgProvisioningService.confirmRoutes` when routed_subnets
 * change, and on NAS soft-delete/disable.
 *
 * Affected users = users with a site/NAS assignment covering `nasId`
 *                + all admin/owner users in that NAS's org.
 *
 * @param {number} nasId
 * @returns {Promise<void>}
 */
async function refreshAffectedByNas(nasId) {
  // Get NAS org
  const [nasRows] = await db.query(
    'SELECT organization_id FROM nas WHERE id = ? AND deleted_at IS NULL',
    [nasId],
  );
  if (!nasRows.length) return;
  const orgId = nasRows[0].organization_id;

  // Users with assignments covering this NAS (direct NAS match or via site)
  const [assignedRows] = await db.query(
    `SELECT DISTINCT una.user_id
       FROM user_network_assignments una
       JOIN nas n ON (
             (una.scope_type = 'nas'  AND una.scope_id = n.id)
          OR (una.scope_type = 'site' AND una.scope_id = n.site_id)
       )
      WHERE n.id = ? AND una.active_flag = 1 AND n.deleted_at IS NULL`,
    [nasId],
  );

  // Admin / owner users in the same org (they reach ALL subnets)
  const [adminRows] = await db.query(
    `SELECT DISTINCT u.id AS user_id
       FROM users u
      WHERE u.organization_id = ? AND u.role = 'admin' AND u.deleted_at IS NULL
      UNION
     SELECT DISTINCT ou.user_id
       FROM organization_users ou
      WHERE ou.organization_id = ? AND ou.role IN ('owner', 'admin') AND ou.deleted_at IS NULL`,
    [orgId, orgId],
  );

  const userIds = new Set([
    ...assignedRows.map((r) => r.user_id),
    ...adminRows.map((r) => r.user_id),
  ]);

  for (const uid of userIds) {
    try {
      await refreshUserPeers(uid);
    } catch (err) {
      logger.warn(
        { userId: uid, nasId, err: err.message },
        'refreshAffectedByNas: refreshUserPeers failed (non-fatal)',
      );
    }
  }
}

module.exports = {
  buildConfig,
  buildQr,
  createPeer,
  rotatePeer,
  revokePeer,
  refreshUserPeers,
  refreshAffectedByNas,
};
