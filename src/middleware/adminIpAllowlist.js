// =============================================================================
// FireISP 5.0 — database-backed admin IP allowlist
// =============================================================================
// ADMIN_IP_ALLOWLIST remains an optional installation-wide override. When it
// is absent, active rows in admin_ip_allowlist enable the control for an
// organization. No active rows means opt-in is incomplete: admin routes remain
// reachable and the web UI shows a persistent setup warning.
// =============================================================================

const db = require('../config/database');
const config = require('../config');
const { ForbiddenError } = require('../utils/errors');
const { normalizeIp, parseEntry, parseAllowlist, isAllowed } = require('./ipAllowlist');

const environmentValue = (config.adminIpAllowlist || '').trim();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

function environmentOverrideConfigured(value = environmentValue) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function listActiveEntries(organizationId, database = db) {
  if (organizationId === null || organizationId === undefined) return [];
  const result = await database.query(
    `SELECT id, organization_id, cidr, description, is_active
     FROM admin_ip_allowlist
     WHERE (organization_id = ? OR organization_id IS NULL)
       AND is_active = 1
       AND deleted_at IS NULL
     ORDER BY id ASC`,
    [organizationId],
  );
  const rows = Array.isArray(result) ? result[0] : [];
  // Defense in depth around adapters/mocks returning a non-row result shape:
  // only a row that is explicitly active and has a CIDR can activate policy.
  return Array.isArray(rows)
    ? rows.filter(row => row && typeof row.cidr === 'string' && Boolean(row.is_active))
    : [];
}

function statusFromEntries(entries, ip) {
  const parsed = entries.map(entry => parseEntry(entry.cidr)).filter(Boolean);
  const enabled = entries.length > 0;
  return {
    enabled,
    source: enabled ? 'database' : 'none',
    configurationValid: !enabled || parsed.length === entries.length,
    activeEntries: entries.length,
    invalidEntries: entries.length - parsed.length,
    currentIp: normalizeIp(ip) || ip || null,
    currentIpAllowed: !enabled || (parsed.length > 0 && isAllowed(ip, parsed)),
  };
}

function statusFromEnvironment(value, ip) {
  const rawEntries = value.split(',').map(item => item.trim()).filter(Boolean);
  const parsedEntries = rawEntries.map(parseEntry).filter(Boolean);
  const allowlist = parseAllowlist(value);
  return {
    enabled: true,
    source: 'environment',
    configurationValid: allowlist !== null && parsedEntries.length === rawEntries.length,
    activeEntries: parsedEntries.length,
    invalidEntries: rawEntries.length - parsedEntries.length,
    currentIp: normalizeIp(ip) || ip || null,
    // A configured-but-invalid override deliberately fails closed.
    currentIpAllowed: allowlist !== null && isAllowed(ip, allowlist),
  };
}

async function getAdminIpAllowlistStatus(organizationId, ip, database = db) {
  if (environmentOverrideConfigured()) {
    return statusFromEnvironment(environmentValue, ip);
  }

  const entries = await listActiveEntries(organizationId, database);
  return statusFromEntries(entries, ip);
}

async function enforceAdminIpAllowlist(req, _res, next) {
  try {
    const status = await getAdminIpAllowlistStatus(
      req.user?.organizationId,
      clientIp(req),
    );
    if (!status.enabled || status.currentIpAllowed) return next();
    return next(new ForbiddenError(
      status.configurationValid
        ? 'Access denied: your IP address is not permitted to access this admin endpoint'
        : 'Access denied: the active admin IP allowlist contains no usable configuration',
    ));
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  clientIp,
  environmentOverrideConfigured,
  listActiveEntries,
  statusFromEntries,
  statusFromEnvironment,
  getAdminIpAllowlistStatus,
  enforceAdminIpAllowlist,
};
