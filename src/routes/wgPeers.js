// =============================================================================
// FireISP 5.0 — WireGuard User Peer Routes (§6d)
// =============================================================================
// Mounted at /api/v1/wg-peers.
//
// Self-service (owner-scoped) — every query carries WHERE user_id=req.user.id:
//   GET    /wg-peers                  list own peers          wireguard.peers.view
//   POST   /wg-peers                  create peer             wireguard.peers.create
//   GET    /wg-peers/:id/config       download .conf or QR    wireguard.peers.view
//   DELETE /wg-peers/:id              revoke own peer         wireguard.peers.delete
//
// Admin oversight (wireguard.peers.admin):
//   GET    /wg-peers/admin/all        all org peers + live stats
//   DELETE /wg-peers/admin/:id        revoke any peer
//   POST   /wg-peers/admin/:id/rotate new keypair; owner re-downloads
//
// Assignment management (wireguard.assignments.manage — admin only):
//   GET    /wg-peers/admin/assignments/:userId  current scopes for a user
//   PUT    /wg-peers/admin/assignments/:userId  replace scopes + live-refresh
//
// IMPORTANT: all /admin/* routes MUST be declared before /:id to prevent
// Express matching 'admin' as the :id segment (workOrders.js §12.3 pattern).
//
// SECURITY:
//   - redactPeer() strips private_key_encrypted + preshared_key_encrypted
//     from EVERY response (private key returned only once: on create, to owner).
//   - Admin never receives key columns (redactPeer always applied).
//   - Owner-scoping: self-service queries carry AND user_id = req.user.id.
// =============================================================================

'use strict';

const { Router } = require('express');
const { authenticate } = require('../middleware/auth');
const { orgScope } = require('../middleware/orgScope');
const { requirePermission } = require('../middleware/rbac');
const { validate } = require('../middleware/validate');
const { wgPeers_createPeer, wgPeers_updateAssignments } = require('../middleware/schemas/wgPeers');
const config = require('../config');
const { decrypt } = require('../utils/encryption');
const { NotFoundError, ValidationError } = require('../utils/errors');
const db = require('../config/database');
const wireguardServerService = require('../services/wireguardServerService');
const userTunnelScopeService = require('../services/userTunnelScopeService');
const userTunnelService = require('../services/userTunnelService');

const router = Router();

// All routes require authentication and org context
router.use(authenticate);
router.use(orgScope);

// ---------------------------------------------------------------------------
// Helper: strip both encrypted key columns from a peer row.
// Called on every response — the only time plaintext keys leave the server is
// on createPeer (returned directly, never persisted in a response object).
// ---------------------------------------------------------------------------
function redactPeer(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  delete out.private_key_encrypted;
  delete out.preshared_key_encrypted;
  return out;
}

// =============================================================================
// ADMIN ROUTES — declared before /:id to prevent route shadowing
// =============================================================================

// Allowlist of wg_user_peers columns safe to sort by in the admin list
const ADMIN_SORTABLE = ['id', 'name', 'tunnel_address', 'created_at', 'updated_at', 'revoked_at'];

// ---------------------------------------------------------------------------
// GET /wg-peers/admin/all — paginated list of ALL org peers with live stats
// ---------------------------------------------------------------------------
router.get('/admin/all', requirePermission('wireguard.peers.admin'), async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;

    const safeOrderBy = ADMIN_SORTABLE.includes(req.query.order_by) ? req.query.order_by : 'created_at';
    const safeOrder   = req.query.order === 'ASC' ? 'ASC' : 'DESC';

    const [rows] = await db.query(
      `SELECT wp.*,
              u.first_name, u.last_name, u.email
         FROM wg_user_peers wp
         JOIN users u ON u.id = wp.user_id
        WHERE wp.organization_id = ? AND wp.deleted_at IS NULL
        ORDER BY wp.${safeOrderBy} ${safeOrder}
        LIMIT ${limit} OFFSET ${offset}`,
      [req.orgId],
    );

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM wg_user_peers wp WHERE wp.organization_id = ? AND wp.deleted_at IS NULL',
      [req.orgId],
    );

    // Merge live handshake data from `wg show wg-clients dump` (graceful when
    // serverEnabled=false — readPeerHandshakes returns {} in that case)
    const liveStats = await wireguardServerService.readPeerHandshakes(
      config.wireguard.clientInterface,
    ).catch(() => ({}));

    const data = rows.map((r) => {
      const live = liveStats[r.public_key] || {};
      return {
        ...redactPeer(r),
        live_last_handshake_unix: live.lastHandshakeUnix || null,
        live_rx_bytes: live.rxBytes || null,
        live_tx_bytes: live.txBytes || null,
        live_endpoint:  live.endpoint || null,
      };
    });

    // Include totalPages so the admin peer list's pagination control renders
    // (the UI reads meta.totalPages; without it the control stayed hidden).
    res.json({ data, meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /wg-peers/admin/:id — admin revoke any peer
// ---------------------------------------------------------------------------
router.delete('/admin/:id', requirePermission('wireguard.peers.admin'), async (req, res, next) => {
  try {
    await userTunnelService.revokePeer(req.params.id, req.orgId, req.user.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /wg-peers/admin/:id/rotate — replace keypair; owner re-downloads /config
// ---------------------------------------------------------------------------
router.post('/admin/:id/rotate', requirePermission('wireguard.peers.admin'), async (req, res, next) => {
  try {
    const peer = await userTunnelService.rotatePeer(req.params.id, req.orgId, req.user.id);
    res.json({ data: redactPeer(peer) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /wg-peers/admin/assignments/:userId — list current scopes for a user
// ---------------------------------------------------------------------------
router.get('/admin/assignments/:userId', requirePermission('wireguard.assignments.manage'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT una.*, n.name AS nas_name, s.name AS site_name
         FROM user_network_assignments una
         LEFT JOIN nas n ON una.scope_type = 'nas'  AND n.id = una.scope_id
         LEFT JOIN sites s ON una.scope_type = 'site' AND s.id = una.scope_id
        WHERE una.user_id = ? AND una.organization_id = ? AND una.deleted_at IS NULL`,
      [req.params.userId, req.orgId],
    );
    // Also return the computed subnets so the admin can preview what the user reaches.
    // Scope the lookup to the current org — return 404 if the target user is not a member.
    const [userRows] = await db.query(
      `SELECT ou.role FROM organization_users ou
         WHERE ou.user_id = ? AND ou.organization_id = ? AND ou.deleted_at IS NULL LIMIT 1`,
      [req.params.userId, req.orgId],
    );
    if (!userRows[0]) return next(new NotFoundError('user'));
    const legacyRole = userRows[0].role || null;
    const subnets = await userTunnelScopeService.getScopedSubnets(
      req.params.userId,
      req.orgId,
      legacyRole,
    );
    res.json({ data: rows, computed_subnets: subnets });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// PUT /wg-peers/admin/assignments/:userId — replace scopes + live-refresh peers
// ---------------------------------------------------------------------------
router.put(
  '/admin/assignments/:userId',
  requirePermission('wireguard.assignments.manage'),
  validate(wgPeers_updateAssignments),
  async (req, res, next) => {
    try {
      const targetUserId = req.params.userId;
      const { scopes } = req.body;

      // validate.js checks that scopes is an array; we validate each element here
      const VALID_SCOPE_TYPES = ['site', 'nas'];
      for (const [i, scope] of scopes.entries()) {
        if (!scope || typeof scope !== 'object') {
          return next(new ValidationError(`scopes[${i}] must be an object`));
        }
        if (!VALID_SCOPE_TYPES.includes(scope.scope_type)) {
          return next(new ValidationError(`scopes[${i}].scope_type must be 'site' or 'nas'`));
        }
        const sid = parseInt(scope.scope_id, 10);
        if (!Number.isFinite(sid) || sid < 1) {
          return next(new ValidationError(`scopes[${i}].scope_id must be a positive integer`));
        }
        scope.scope_id = sid; // normalise
      }

      // Validate each scope_id belongs to req.orgId before mutating anything.
      for (const [i, scope] of scopes.entries()) {
        const table = scope.scope_type === 'nas' ? 'nas' : 'sites';
        const [scopeRows] = await db.query(
          `SELECT id FROM ${table} WHERE id = ? AND organization_id = ?`,
          [scope.scope_id, req.orgId],
        );
        if (!scopeRows[0]) {
          return next(new ValidationError(`scopes[${i}].scope_id ${scope.scope_id} not found in organization`));
        }
      }

      // Replace assignments atomically: soft-delete all current, insert new
      await db.query(
        'UPDATE user_network_assignments SET deleted_at = NOW() WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL',
        [targetUserId, req.orgId],
      );
      for (const scope of scopes) {
        await db.query(
          'INSERT INTO user_network_assignments (organization_id, user_id, scope_type, scope_id, created_by) VALUES (?, ?, ?, ?, ?)',
          [req.orgId, targetUserId, scope.scope_type, scope.scope_id, req.user.id],
        );
      }

      // Live-refresh all peers for the affected user so tunnels re-scope immediately
      await userTunnelService.refreshUserPeers(targetUserId);

      // Return new assignments
      const [rows] = await db.query(
        `SELECT una.*, n.name AS nas_name, s.name AS site_name
           FROM user_network_assignments una
           LEFT JOIN nas n ON una.scope_type = 'nas'  AND n.id = una.scope_id
           LEFT JOIN sites s ON una.scope_type = 'site' AND s.id = una.scope_id
          WHERE una.user_id = ? AND una.organization_id = ? AND una.deleted_at IS NULL`,
        [targetUserId, req.orgId],
      );
      res.json({ data: rows });
    } catch (err) { next(err); }
  },
);

// =============================================================================
// SELF-SERVICE ROUTES (owner-scoped)
// =============================================================================

// ---------------------------------------------------------------------------
// GET /wg-peers — list own peers (redacted, with snapshot + last_handshake_at)
// ---------------------------------------------------------------------------
router.get('/', requirePermission('wireguard.peers.view'), async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT *
         FROM wg_user_peers
        WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [req.user.id, req.orgId],
    );
    res.json({ data: rows.map(redactPeer) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /wg-peers — create a new peer (private key returned ONLY here)
// ---------------------------------------------------------------------------
router.post(
  '/',
  requirePermission('wireguard.peers.create'),
  validate(wgPeers_createPeer),
  async (req, res, next) => {
    try {
      // full_tunnel defaults to true: any value other than explicit false means full-tunnel
      const fullTunnel = req.body.full_tunnel !== false;
      const { peer, config, config_base64, qr_svg } = await userTunnelService.createPeer(
        req.user.id,
        req.orgId,
        req.user.role,
        req.body.name,
        fullTunnel,
      );
      res.status(201).json({
        data: redactPeer(peer),
        config,
        config_base64,
        qr_svg,
      });
    } catch (err) { next(err); }
  },
);

// ---------------------------------------------------------------------------
// GET /wg-peers/:id/config — persistent profile re-download (.conf or QR SVG)
// Query params:
//   format=conf  (default) — returns WireGuard .conf plain text
//   format=qr              — returns inline SVG QR code
//   download=1             — adds Content-Disposition: attachment header
// ---------------------------------------------------------------------------
router.get('/:id/config', requirePermission('wireguard.peers.view'), async (req, res, next) => {
  try {
    const [[peer]] = await db.query(
      'SELECT * FROM wg_user_peers WHERE id = ? AND user_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.user.id, req.orgId],
    );
    if (!peer) return next(new NotFoundError('wg_user_peers'));

    // Decrypt private key — NEVER log
    const privateKey    = decrypt(peer.private_key_encrypted);
    const presharedKey  = peer.preshared_key_encrypted
      ? decrypt(peer.preshared_key_encrypted)
      : null;

    // Recompute scope at download time (reflects latest assignment changes)
    const subnets = await userTunnelScopeService.getScopedSubnets(
      req.user.id,
      req.orgId,
      req.user.role,
    );

    const confText = userTunnelService.buildConfig(peer, privateKey, subnets, presharedKey);
    const format   = req.query.format === 'qr' ? 'qr' : 'conf';
    const download = req.query.download === '1';

    // Sanitise the peer name for use in the Content-Disposition filename
    const safeName = (peer.name || 'peer').replace(/[^a-zA-Z0-9_-]/g, '_');

    if (format === 'qr') {
      const svg = await userTunnelService.buildQr(confText);
      if (download) {
        res.setHeader('Content-Disposition', `attachment; filename="wg-${safeName}.svg"`);
      }
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send(svg);
    }

    // Default: .conf text
    if (download) {
      res.setHeader('Content-Disposition', `attachment; filename="wg-${safeName}.conf"`);
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(confText);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// DELETE /wg-peers/:id — self-revoke (owner only)
// ---------------------------------------------------------------------------
router.delete('/:id', requirePermission('wireguard.peers.delete'), async (req, res, next) => {
  try {
    // Verify ownership before delegating to revokePeer
    const [[peer]] = await db.query(
      'SELECT id FROM wg_user_peers WHERE id = ? AND user_id = ? AND organization_id = ? AND deleted_at IS NULL',
      [req.params.id, req.user.id, req.orgId],
    );
    if (!peer) return next(new NotFoundError('wg_user_peers'));

    await userTunnelService.revokePeer(req.params.id, req.orgId, req.user.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
