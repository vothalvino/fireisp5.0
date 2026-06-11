// =============================================================================
// FireISP 5.0 — Pool Assignment Service
// =============================================================================
// Handles dynamic IP/prefix assignment from ip_pools and overlap detection.
// =============================================================================
'use strict';

const db = require('../config/database');

// ---- IPv4 utilities ----

/**
 * Convert a dotted-decimal IPv4 string to a 32-bit unsigned integer.
 * @param {string} ip
 * @returns {number}
 */
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc * 256) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Convert a 32-bit unsigned integer to a dotted-decimal IPv4 string.
 * @param {number} n
 * @returns {string}
 */
function intToIpv4(n) {
  return [
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>>  8) & 0xff,
    n & 0xff,
  ].join('.');
}

/**
 * Parse prefix length from a subnet mask string or CIDR slash notation.
 * Accepts: '255.255.255.0', '24', '/24'
 * @param {string} subnetMask
 * @returns {number} prefix length (0-32)
 */
function parseCidrPrefixLen(subnetMask) {
  if (!subnetMask) return 32;
  const trimmed = subnetMask.trim();
  // Handle /N or N notation
  if (trimmed.startsWith('/')) return parseInt(trimmed.slice(1), 10);
  if (/^\d{1,2}$/.test(trimmed)) return parseInt(trimmed, 10);
  // Dotted-decimal mask: count set bits
  const n = ipv4ToInt(trimmed);
  let count = 0;
  let mask = n;
  while (mask) {
    count += mask & 1;
    mask >>>= 1;
  }
  return count;
}

/**
 * Parse an IPv4 pool into { network (uint32), broadcast (uint32) }.
 * Handles CIDR in pool.network (e.g. "10.0.0.0/24") or dotted-decimal + subnet_mask.
 * @param {object} pool - ip_pools row
 * @returns {{ network: number, broadcast: number } | null}
 */
function parseIpv4Pool(pool) {
  try {
    let networkAddr;
    let prefixLen;

    if (pool.network && pool.network.includes('/')) {
      const [addr, prefix] = pool.network.split('/');
      networkAddr = addr.trim();
      prefixLen = parseInt(prefix, 10);
    } else {
      networkAddr = pool.network;
      prefixLen = parseCidrPrefixLen(pool.subnet_mask);
    }

    const netInt = ipv4ToInt(networkAddr) >>> 0;
    const hostBits = 32 - prefixLen;
    const mask = hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
    const network = (netInt & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;

    return { network, broadcast, prefixLen };
  } catch (_err) {
    return null;
  }
}

/**
 * Check if a given IPv4 integer falls within any CIDR or single IP listed in
 * an excluded_ranges string (newline- or comma-separated).
 * @param {number} ipInt
 * @param {string|null} excludedRanges
 * @returns {boolean}
 */
function isIpv4Excluded(ipInt, excludedRanges) {
  if (!excludedRanges) return false;
  const entries = excludedRanges.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  for (const entry of entries) {
    try {
      if (entry.includes('/')) {
        const [addr, prefix] = entry.split('/');
        const prefixLen = parseInt(prefix, 10);
        const hostBits = 32 - prefixLen;
        const mask = hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
        const net = (ipv4ToInt(addr.trim()) & mask) >>> 0;
        const bcast = (net | (~mask >>> 0)) >>> 0;
        if (ipInt >= net && ipInt <= bcast) return true;
      } else {
        if (ipv4ToInt(entry) === ipInt) return true;
      }
    } catch (_err) {
      // skip malformed entry
    }
  }
  return false;
}

// ---- IPv6 utilities (BigInt) ----

/**
 * Expand a compressed IPv6 address string to its full 128-bit BigInt representation.
 * Handles '::' expansion.
 * @param {string} ip
 * @returns {BigInt}
 */
function ipv6ToBigInt(ip) {
  // Expand '::' shorthand
  let expanded = ip;
  if (ip.includes('::')) {
    const halves = ip.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0000');
    expanded = [...left, ...middle, ...right].join(':');
  }
  const groups = expanded.split(':');
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(parseInt(group || '0', 16)), 0n);
}

/**
 * Convert a 128-bit BigInt to a full (un-compressed) IPv6 string.
 * @param {BigInt} n
 * @returns {string}
 */
function bigIntToIpv6(n) {
  const groups = [];
  let remaining = n;
  for (let i = 0; i < 8; i++) {
    groups.unshift((remaining & 0xffffn).toString(16).padStart(4, '0'));
    remaining >>= 16n;
  }
  return groups.join(':');
}

/**
 * Parse an IPv6 CIDR pool (e.g. "2001:db8::/32") into { networkBig, broadcastBig, prefixLen }.
 * @param {object} pool - ip_pools row; pool.network must contain CIDR notation
 * @returns {{ networkBig: BigInt, broadcastBig: BigInt, prefixLen: number } | null}
 */
function parseIpv6Pool(pool) {
  try {
    if (!pool.network || !pool.network.includes('/')) return null;
    const [addr, prefix] = pool.network.split('/');
    const prefixLen = parseInt(prefix, 10);
    const addrBig = ipv6ToBigInt(addr.trim());
    const hostBits = 128 - prefixLen;
    const mask = hostBits === 128 ? 0n : (~((1n << BigInt(hostBits)) - 1n)) & ((1n << 128n) - 1n);
    const networkBig = addrBig & mask;
    const broadcastBig = networkBig | ((1n << BigInt(hostBits)) - 1n);
    return { networkBig, broadcastBig, prefixLen };
  } catch (_err) {
    return null;
  }
}

/**
 * Check if a BigInt IPv6 address falls within any CIDR/IP in excluded_ranges.
 * @param {BigInt} ipBig
 * @param {string|null} excludedRanges
 * @returns {boolean}
 */
function isIpv6Excluded(ipBig, excludedRanges) {
  if (!excludedRanges) return false;
  const entries = excludedRanges.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  for (const entry of entries) {
    try {
      if (entry.includes('/')) {
        const [addr, prefix] = entry.split('/');
        const prefixLen = parseInt(prefix, 10);
        const hostBits = 128 - prefixLen;
        const mask = hostBits === 128 ? 0n : (~((1n << BigInt(hostBits)) - 1n)) & ((1n << 128n) - 1n);
        const net = ipv6ToBigInt(addr.trim()) & mask;
        const bcast = net | ((1n << BigInt(hostBits)) - 1n);
        if (ipBig >= net && ipBig <= bcast) return true;
      } else {
        if (ipv6ToBigInt(entry) === ipBig) return true;
      }
    } catch (_err) {
      // skip malformed entry
    }
  }
  return false;
}

// ---- Overlap detection ----

/**
 * Check if pool overlaps with any other active pool in the same org + ip_version.
 * Returns the first conflicting peer pool row, or null if no overlap.
 * @param {object} pool - must have: organization_id, ip_version, network, subnet_mask
 * @param {number|null} excludePoolId - the pool's own id when updating
 * @returns {Promise<object|null>}
 */
async function detectOverlap(pool, excludePoolId = null) {
  const conditions = ['deleted_at IS NULL', 'ip_version = ?', 'organization_id = ?'];
  const params = [pool.ip_version, pool.organization_id];
  if (excludePoolId) {
    conditions.push('id != ?');
    params.push(excludePoolId);
  }
  const [peers] = await db.query(
    `SELECT * FROM ip_pools WHERE ${conditions.join(' AND ')}`,
    params,
  );

  for (const peer of peers) {
    if (pool.ip_version === '6') {
      const a = parseIpv6Pool(pool);
      const b = parseIpv6Pool(peer);
      if (!a || !b) continue;
      if (a.networkBig <= b.broadcastBig && a.broadcastBig >= b.networkBig) return peer;
    } else {
      const a = parseIpv4Pool(pool);
      const b = parseIpv4Pool(peer);
      if (!a || !b) continue;
      if (a.network <= b.broadcast && a.broadcast >= b.network) return peer;
    }
  }
  return null;
}

/**
 * Assert no overlap; throws { status: 409, message } if overlap found.
 * @param {object} pool
 * @param {number|null} excludePoolId
 */
async function assertNoOverlap(pool, excludePoolId = null) {
  const conflict = await detectOverlap(pool, excludePoolId);
  if (conflict) {
    const err = new Error(
      `Pool overlaps with existing pool "${conflict.name}" (${conflict.network})`,
    );
    err.status = 409;
    throw err;
  }
}

// ---- Assignment ----

/**
 * Assign the next free IPv4 address from a pool.
 * Skips: network address, broadcast, gateway, excluded_ranges, and already-assigned IPs.
 * Inserts a row into ip_assignments and returns the assigned IP string.
 * @param {object} pool
 * @param {{ contractId: number, clientId: number, type: string }} opts
 * @returns {Promise<string>}
 */
async function assignNextFreeIpv4(pool, { contractId, clientId, type }) {
  const parsed = parseIpv4Pool(pool);
  if (!parsed) throw Object.assign(new Error('Unable to parse IPv4 pool'), { status: 422 });

  const { network, broadcast } = parsed;
  const gatewayInt = pool.gateway ? ipv4ToInt(pool.gateway) : null;

  // Fetch all currently-assigned (non-expired) IPs for this pool
  const [assignedRows] = await db.query(
    `SELECT ip_address FROM ip_assignments
     WHERE pool_id = ? AND deleted_at IS NULL AND status != 'expired'`,
    [pool.id],
  );
  const taken = new Set(assignedRows.map(r => r.ip_address));

  // Iterate usable range (network+1 to broadcast-1)
  for (let i = network + 1; i < broadcast; i++) {
    if (i === gatewayInt) continue;
    if (isIpv4Excluded(i, pool.excluded_ranges)) continue;
    const candidate = intToIpv4(i);
    if (taken.has(candidate)) continue;

    // Insert assignment
    const [result] = await db.query(
      `INSERT INTO ip_assignments (pool_id, organization_id, ip_address, contract_id, client_id, type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [pool.id, pool.organization_id, candidate, contractId || null, clientId || null, type],
    );
    const [rows] = await db.query('SELECT * FROM ip_assignments WHERE id = ?', [result.insertId]);
    return rows[0];
  }

  throw Object.assign(new Error('No free IPv4 addresses available in pool'), { status: 422 });
}

/**
 * Assign the next free IPv6 prefix from a pool.
 * Steps through prefixes of size 2^(128 - pool.default_prefix_len).
 * Skips excluded_ranges and existing active ip_assignments.
 * @param {object} pool
 * @param {{ contractId: number, clientId: number, type: string }} opts
 * @returns {Promise<object>}
 */
async function assignNextFreeIpv6Prefix(pool, { contractId, clientId, type }) {
  const parsed = parseIpv6Pool(pool);
  if (!parsed) throw Object.assign(new Error('Unable to parse IPv6 pool'), { status: 422 });
  if (!pool.default_prefix_len) {
    throw Object.assign(new Error('Pool missing default_prefix_len for IPv6 prefix delegation'), { status: 422 });
  }

  const { networkBig, broadcastBig } = parsed;
  const blockSize = 1n << BigInt(128 - pool.default_prefix_len);

  // Fetch all currently-assigned (non-expired) prefixes for this pool
  const [assignedRows] = await db.query(
    `SELECT ip_address FROM ip_assignments
     WHERE pool_id = ? AND deleted_at IS NULL AND status != 'expired'`,
    [pool.id],
  );
  const taken = new Set(assignedRows.map(r => r.ip_address));

  for (let prefixStart = networkBig; prefixStart + blockSize - 1n <= broadcastBig; prefixStart += blockSize) {
    if (isIpv6Excluded(prefixStart, pool.excluded_ranges)) continue;
    const candidate = `${bigIntToIpv6(prefixStart)}/${pool.default_prefix_len}`;
    const candidateAddr = bigIntToIpv6(prefixStart);
    // Check both the full CIDR and the address part
    if (taken.has(candidate) || taken.has(candidateAddr)) continue;

    const [result] = await db.query(
      `INSERT INTO ip_assignments (pool_id, organization_id, ip_address, contract_id, client_id, type, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [pool.id, pool.organization_id, candidate, contractId || null, clientId || null, type],
    );
    const [rows] = await db.query('SELECT * FROM ip_assignments WHERE id = ?', [result.insertId]);
    return rows[0];
  }

  throw Object.assign(new Error('No free IPv6 prefixes available in pool'), { status: 422 });
}

/**
 * Main entry point: assign next free IP or IPv6 prefix from the specified pool.
 * @param {number|string} poolId
 * @param {{ contractId: number, clientId: number, type?: string, orgId: number }} opts
 * @returns {Promise<object>} the new ip_assignments row
 */
async function assignNextFreeIp(poolId, { contractId, clientId, type = 'dynamic', orgId: _orgId }) {
  const [rows] = await db.query(
    'SELECT * FROM ip_pools WHERE id = ? AND deleted_at IS NULL',
    [poolId],
  );
  if (!rows.length) throw Object.assign(new Error('Pool not found'), { status: 404 });
  const pool = rows[0];

  if (pool.ip_version === '6') {
    return assignNextFreeIpv6Prefix(pool, { contractId, clientId, type });
  }
  return assignNextFreeIpv4(pool, { contractId, clientId, type });
}

module.exports = {
  assignNextFreeIp,
  detectOverlap,
  assertNoOverlap,
  parseIpv4Pool,
  ipv4ToInt,
  intToIpv4,
  parseIpv6Pool,
  ipv6ToBigInt,
  bigIntToIpv6,
};
