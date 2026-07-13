'use strict';

// =============================================================================
// FireISP 5.0 — Subnet Planner Service
// =============================================================================

const db = require('../config/database');
const { computeUsableCount } = require('./poolUtilizationService');

/**
 * Expand a compressed IPv6 address to full 8-group notation.
 * @param {string} addr
 * @returns {string}
 */
function expandIPv6(addr) {
  let full = addr;
  if (full.includes('::')) {
    const sides = full.split('::');
    const left = sides[0] ? sides[0].split(':') : [];
    const right = sides[1] ? sides[1].split(':') : [];
    const missing = 8 - left.length - right.length;
    const middle = Array(missing).fill('0000');
    full = [...left, ...middle, ...right].join(':');
  }
  return full.split(':').map(g => g.padStart(4, '0')).join(':');
}

/**
 * Split an IPv4 network CIDR into equal subnets.
 * @param {string} baseAddr
 * @param {number} prefixLen
 * @param {number} subPrefixLen
 * @param {number} subnetCount
 * @returns {string[]}
 */
function planSubnetsIPv4(baseAddr, prefixLen, subPrefixLen, subnetCount) {
  const parts = baseAddr.split('.').map(Number);
  let base = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;

  // Mask off to network boundary
  const mask = prefixLen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
  base = (base & mask) >>> 0;

  const step = prefixLen === subPrefixLen ? 0 : (1 << (32 - subPrefixLen)) >>> 0;
  const subnets = [];

  for (let i = 0; i < subnetCount; i++) {
    const addr = (base + i * step) >>> 0;
    const a = (addr >>> 24) & 0xFF;
    const b = (addr >>> 16) & 0xFF;
    const c = (addr >>> 8) & 0xFF;
    const d = addr & 0xFF;
    subnets.push(`${a}.${b}.${c}.${d}/${subPrefixLen}`);
  }

  return subnets;
}

/**
 * Split an IPv6 network CIDR into equal subnets.
 * @param {string} baseAddr
 * @param {number} prefixLen
 * @param {number} subPrefixLen
 * @param {number} subnetCount
 * @returns {string[]}
 */
function planSubnetsIPv6(baseAddr, prefixLen, subPrefixLen, subnetCount) {
  const expanded = expandIPv6(baseAddr);
  const groups = expanded.split(':').map(g => parseInt(g, 16));

  // Convert to BigInt for arithmetic
  let base = BigInt(0);
  for (const g of groups) {
    base = (base << BigInt(16)) | BigInt(g);
  }

  // Mask off to network boundary
  const totalBits = BigInt(128);
  const maskBits = BigInt(prefixLen);
  const mask = prefixLen === 0
    ? BigInt(0)
    : ((BigInt(1) << totalBits) - BigInt(1)) - ((BigInt(1) << (totalBits - maskBits)) - BigInt(1));
  base = base & mask;

  const step = BigInt(1) << (totalBits - BigInt(subPrefixLen));
  const subnets = [];

  for (let i = 0; i < subnetCount; i++) {
    const addr = base + BigInt(i) * step;
    // Convert back to IPv6 hex groups
    const hex = addr.toString(16).padStart(32, '0');
    const groups2 = [];
    for (let j = 0; j < 8; j++) {
      groups2.push(hex.slice(j * 4, j * 4 + 4));
    }
    subnets.push(`${groups2.join(':')}/${subPrefixLen}`);
  }

  return subnets;
}

/**
 * Split a network CIDR into equal subnets.
 * @param {string} network - e.g. '2001:db8::/32' or '10.0.0.0/8'
 * @param {number} prefixLen - parent prefix length (e.g. 32)
 * @param {number} subPrefixLen - desired subnet prefix length (e.g. 48)
 * @returns {string[]} array of subnet CIDR strings
 */
function planSubnets(network, prefixLen, subPrefixLen) {
  if (subPrefixLen < prefixLen) {
    throw new Error('sub_prefix_len must be >= prefix_len');
  }

  const cidr = network.includes('/') ? network : `${network}/${prefixLen}`;
  const [baseAddr] = cidr.split('/');

  const subnetCount = Math.pow(2, subPrefixLen - prefixLen);
  if (subnetCount > 65536) {
    throw new Error('Too many subnets requested (max 65536)');
  }

  if (baseAddr.includes(':')) {
    return planSubnetsIPv6(baseAddr, prefixLen, subPrefixLen, subnetCount);
  }
  return planSubnetsIPv4(baseAddr, prefixLen, subPrefixLen, subnetCount);
}

/**
 * Convert a CIDR string to a numeric range object for overlap detection.
 * @param {string} cidr
 * @returns {{ start: bigint, end: bigint, v6: boolean } | null}
 */
function cidrToRange(cidr) {
  if (!cidr || !cidr.includes('/')) return null;
  const [addr, bits] = cidr.split('/');
  const prefix = parseInt(bits, 10);

  if (addr.includes(':')) {
    // IPv6
    const expanded = expandIPv6(addr);
    const groups = expanded.split(':').map(g => parseInt(g, 16));
    let base = BigInt(0);
    for (const g of groups) base = (base << BigInt(16)) | BigInt(g);
    const totalBits = BigInt(128);
    const mask = prefix === 0
      ? BigInt(0)
      : ((BigInt(1) << totalBits) - BigInt(1)) - ((BigInt(1) << (totalBits - BigInt(prefix))) - BigInt(1));
    base = base & mask;
    const end = base + (BigInt(1) << (totalBits - BigInt(prefix))) - BigInt(1);
    return { start: base, end, v6: true };
  }

  // IPv4
  const parts = addr.split('.').map(Number);
  let base = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const step = prefix === 32 ? 1 : (1 << (32 - prefix)) >>> 0;
  base = (base & ((0xFFFFFFFF << (32 - prefix)) >>> 0)) >>> 0;
  const end = (base + step - 1) >>> 0;
  return { start: BigInt(base), end: BigInt(end), v6: false };
}

/**
 * Returns true when two CIDRs overlap.
 * @param {string} cidr1
 * @param {string} cidr2
 * @returns {boolean}
 */
function cidrsOverlap(cidr1, cidr2) {
  const r1 = cidrToRange(cidr1);
  const r2 = cidrToRange(cidr2);
  if (!r1 || !r2 || r1.v6 !== r2.v6) return false;
  return r1.start <= r2.end && r2.start <= r1.end;
}

/**
 * Detect overlapping ip_pools for an organization.
 * @param {number} orgId
 * @returns {Promise<Array>}
 */
async function detectConflicts(orgId) {
  const [rows] = await db.query(
    `SELECT a.id AS pool_a_id, a.name AS pool_a_name, a.network AS pool_a_network,
            b.id AS pool_b_id, b.name AS pool_b_name, b.network AS pool_b_network
     FROM ip_pools a
     JOIN ip_pools b ON a.organization_id = b.organization_id
       AND a.id < b.id
       AND a.network IS NOT NULL
       AND b.network IS NOT NULL
     WHERE a.organization_id = ?
       AND a.deleted_at IS NULL
       AND b.deleted_at IS NULL`,
    [orgId],
  );

  // Filter actual overlaps in JS (MySQL lacks native CIDR overlap operators)
  return rows.filter(row => {
    try {
      return cidrsOverlap(row.pool_a_network, row.pool_b_network);
    } catch {
      return false;
    }
  });
}

/**
 * Get utilization stats for a pool.
 * @param {number} poolId
 * @returns {Promise<{assigned: number, total: number, percent: number}>}
 */
async function getUtilization(poolId) {
  // ip_pools has no `subnet_size` column — pool capacity is derived from
  // network/subnet_mask/ip_version (and, for IPv6, default_prefix_len) via
  // poolUtilizationService.computeUsableCount, the same helper the pool
  // threshold-alert job uses, so the two never disagree on pool size.
  const [[pool]] = await db.query(
    'SELECT network, subnet_mask, ip_version, default_prefix_len FROM ip_pools WHERE id = ? AND deleted_at IS NULL',
    [poolId],
  );
  if (!pool) return { assigned: 0, total: 0, percent: 0 };

  const [[{ assigned }]] = await db.query(
    'SELECT COUNT(*) AS assigned FROM ip_assignments WHERE pool_id = ? AND deleted_at IS NULL',
    [poolId],
  );

  const total = computeUsableCount(pool);
  const percent = total > 0 ? Math.round((assigned / total) * 100) : 0;
  return { assigned, total, percent };
}

module.exports = { planSubnets, detectConflicts, getUtilization };
