// =============================================================================
// FireISP 5.0 — IP Allowlist Middleware
// =============================================================================
// Restricts access to admin endpoints to a configurable set of IP addresses
// and/or CIDR ranges. Enabled by setting the ADMIN_IP_ALLOWLIST environment
// variable to a comma-separated list (e.g. "10.0.0.0/8,203.0.113.5").
//
// When ADMIN_IP_ALLOWLIST is not set the middleware is a no-op, so the feature
// is opt-in and does not break existing deployments.
//
// Supported formats per entry:
//   • IPv4 address          — 192.168.1.10
//   • IPv4 CIDR range       — 10.0.0.0/8
//   • IPv4-mapped IPv6      — ::ffff:192.168.1.10  (normalised to IPv4)
// =============================================================================

const { ForbiddenError } = require('../utils/errors');

// ---------------------------------------------------------------------------
// Internal helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Convert a dotted-decimal IPv4 string to an unsigned 32-bit integer.
 * Returns null when the string is not a valid IPv4 address.
 *
 * @param {string} ip
 * @returns {number|null}
 */
function ipv4ToInt(ip) {
  if (typeof ip !== 'string') return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (!Number.isInteger(n) || n < 0 || n > 255 || String(n) !== part) return null;
    result = (result * 256 + n) >>> 0;
  }
  return result;
}

/**
 * Normalise an IP address string:
 *   • Strips IPv6 zone IDs (e.g. fe80::1%eth0 → fe80::1)
 *   • Converts IPv4-mapped IPv6 (::ffff:a.b.c.d) to plain IPv4
 *
 * @param {string} ip
 * @returns {string|null}
 */
function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  // strip zone ID
  const zoneIdx = ip.indexOf('%');
  const stripped = zoneIdx !== -1 ? ip.slice(0, zoneIdx) : ip;
  // IPv4-mapped IPv6: ::ffff:a.b.c.d
  const mappedDotted = stripped.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (mappedDotted) return mappedDotted[1];
  // IPv4-mapped IPv6 in hex form: ::ffff:aabb:ccdd
  const mappedHex = stripped.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return stripped;
}

/**
 * Parse a single allowlist entry (IPv4 address or CIDR).
 * Returns null when the entry cannot be parsed.
 *
 * @param {string} entry
 * @returns {{ network: number, mask: number }|null}
 */
function parseEntry(entry) {
  if (!entry || typeof entry !== 'string') return null;
  const trimmed = entry.trim();
  if (!trimmed) return null;

  if (trimmed.includes('/')) {
    // CIDR notation
    const slashIdx = trimmed.indexOf('/');
    const ipPart = trimmed.slice(0, slashIdx).trim();
    const prefixStr = trimmed.slice(slashIdx + 1).trim();
    const prefix = parseInt(prefixStr, 10);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    const ipInt = ipv4ToInt(ipPart);
    if (ipInt === null) return null;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    const network = (ipInt & mask) >>> 0;
    return { network, mask };
  }

  // Plain IPv4 address
  const ipInt = ipv4ToInt(trimmed);
  if (ipInt === null) return null;
  return { network: ipInt, mask: 0xffffffff };
}

/**
 * Parse the ADMIN_IP_ALLOWLIST value into an array of network/mask pairs.
 * Returns null when the input is empty (feature disabled — allow all).
 *
 * @param {string|undefined} raw — comma-separated IP / CIDR list
 * @returns {Array<{ network: number, mask: number }>|null}
 */
function parseAllowlist(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;
  const entries = raw.split(',').map(parseEntry).filter(Boolean);
  return entries.length === 0 ? null : entries;
}

/**
 * Test whether an IP address is allowed by the given allowlist.
 *
 * @param {string} ip — remote IP address (IPv4 or IPv4-mapped IPv6)
 * @param {Array<{ network: number, mask: number }>|null} allowlist
 * @returns {boolean}
 */
function isAllowed(ip, allowlist) {
  if (!allowlist) return true; // feature disabled
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const ipInt = ipv4ToInt(normalized);
  if (ipInt === null) return false;
  return allowlist.some(({ network, mask }) => (ipInt & mask) >>> 0 === network);
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Build an Express middleware that enforces the given IP allowlist.
 * Pass null (or omit) to get a no-op middleware (feature disabled).
 *
 * @param {Array<{ network: number, mask: number }>|null} allowlist
 * @returns {import('express').RequestHandler}
 */
function createIpAllowlist(allowlist) {
  if (!allowlist) {
    return function ipAllowlistDisabled(_req, _res, next) {
      next();
    };
  }

  return function ipAllowlistMiddleware(req, _res, next) {
    const clientIp = req.ip || (req.socket && req.socket.remoteAddress) || '';
    if (isAllowed(clientIp, allowlist)) return next();
    next(new ForbiddenError('Access denied: your IP address is not permitted to access this endpoint'));
  };
}

module.exports = { ipv4ToInt, normalizeIp, parseEntry, parseAllowlist, isAllowed, createIpAllowlist };
