// =============================================================================
// FireISP 5.0 — User Tunnel Scope Service (§6a)
// =============================================================================
// Single source of truth for which device subnets a given user is allowed to
// reach through the wg-clients→wg-fireisp FORWARD chain.
//
// Role logic:
//   admin / owner  → all live routed_subnets in the org's nas_wg_tunnels
//   technician / support / others → only subnets reachable through their
//       admin-granted user_network_assignments (site or NAS grain)
//
// The returned list feeds:
//   - WireGuard .conf AllowedIPs (client routing convenience)
//   - nftables per-user FORWARD set (authoritative ACL — not config-trusted)
//   - allowed_ips_snapshot column (audit + list display)
//
// Empty scope (tech with no assignments) → valid peer that reaches nothing
// until an admin assigns subnets via PUT /wg-peers/admin/assignments/:userId.
// =============================================================================

'use strict';

const db = require('../config/database');
const User = require('../models/User');
const logger = require('../utils/logger').child({ service: 'userTunnelScopeService' });

/**
 * Flatten, deduplicate, and sort an array of CIDR strings.
 *
 * @param {string[]} cidrs
 * @returns {string[]}
 */
function dedupeSort(cidrs) {
  return [...new Set(cidrs.filter(Boolean))].sort();
}

/**
 * Parse a `routed_subnets` column value into a flat string array.
 * The column is stored as a JSON array of CIDR strings; mysql2 returns it
 * pre-parsed when the server signals the JSON type, or as a string otherwise.
 *
 * @param {string|string[]|null} raw
 * @returns {string[]}
 */
function parseRoutedSubnets(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Return the set of device-side CIDRs this user is allowed to reach through
 * the WireGuard user-tunnel hub.
 *
 * Admins/owners reach ALL active routed_subnets in the org.
 * Technicians/support reach only the subnets behind their assigned sites/NASes.
 *
 * @param {number} userId
 * @param {number|null} orgId
 * @param {string|null} legacyRole   value of users.role for the requesting user
 * @returns {Promise<string[]>} deduped, sorted CIDR list (may be empty)
 */
async function getScopedSubnets(userId, orgId, legacyRole) {
  // Resolve the org-level role (organization_users takes precedence over users.role)
  const orgRole = await User.getOrgRole(userId, orgId).catch((err) => {
    logger.warn({ userId, orgId, err: err.message }, 'getScopedSubnets: getOrgRole failed, falling back to legacyRole');
    return null;
  });

  const isAdmin =
    legacyRole === 'admin' ||
    (orgRole && ['owner', 'admin'].includes(orgRole));

  let rows;

  if (isAdmin) {
    // Admins reach ALL device subnets that have an active tunnel in the org.
    // Join nas so a soft-deleted NAS's tunnel drops out — the technician branch
    // below already filters n.deleted_at, and a soft-deleted NAS's subnets must
    // not stay in any user's scope.
    [rows] = await db.query(
      `SELECT t.routed_subnets
         FROM nas_wg_tunnels t
         JOIN nas n ON n.id = t.nas_id AND n.deleted_at IS NULL
        WHERE t.deleted_at IS NULL
          AND t.state IN ('active', 'manual')
          AND (t.organization_id = ? OR t.organization_id IS NULL)`,
      [orgId],
    );
  } else {
    // Technician / support: union over subnets reachable through their
    // durable admin-granted network assignments.  Scope can be 'nas' (single
    // device) or 'site' (all NASes at a site).
    [rows] = await db.query(
      `SELECT DISTINCT t.routed_subnets
         FROM user_network_assignments una
         JOIN nas n ON (
               (una.scope_type = 'nas'  AND n.id      = una.scope_id)
            OR (una.scope_type = 'site' AND n.site_id = una.scope_id)
         ) AND n.deleted_at IS NULL
         JOIN nas_wg_tunnels t
           ON t.nas_id = n.id
          AND t.deleted_at IS NULL
          AND t.state IN ('active', 'manual')
        WHERE una.user_id = ? AND una.active_flag = 1`,
      [userId],
    );
  }

  // Flatten JSON arrays from each row, deduplicate, sort
  const all = rows.flatMap((r) => parseRoutedSubnets(r.routed_subnets));
  return dedupeSort(all);
}

module.exports = { getScopedSubnets };
