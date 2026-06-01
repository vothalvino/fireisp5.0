// =============================================================================
// FireISP 5.0 — Subscriber Provisioning Service
// =============================================================================
// Handles the network-side provisioning that must happen over a contract's
// lifecycle:
//   1. Auto-generate a PPPoE username + (cleartext, recoverable) password when a
//      PPPoE / PPPoE-dual contract is created, and persist it as a RADIUS
//      account so the credentials stay visible for future operator reference.
//   2. Enable a new IPv6 "line" when a contract is upgraded from an IPv4-only
//      connection type to a dual-stack one (IPv4 -> DUAL).
//   3. Keep track of used IP addresses and reject duplicate assignments.
//
// All database access goes through an injected `runner` (either the shared pool
// `db` or an open transaction connection) so callers can run provisioning
// atomically inside the same transaction as the contract write.
// =============================================================================

const crypto = require('crypto');
const { ConflictError } = require('../utils/errors');
const logger = require('../utils/logger').child({ service: 'provisioning' });

// Connection types that authenticate through RADIUS (PPPoE).
const PPPOE_TYPES = ['pppoe', 'pppoe_dual'];
// Connection types that carry an IPv6 line in addition to IPv4 (dual-stack).
const DUAL_TYPES = ['pppoe_dual', 'dual'];
// Connection types that are IPv4 only.
const IPV4_ONLY_TYPES = ['pppoe', 'static'];

// Unambiguous alphabets (no 0/O/1/l/I) so credentials are easy to read aloud.
const USERNAME_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** @returns {boolean} Whether the connection type uses PPPoE/RADIUS. */
function isPppoe(type) { return PPPOE_TYPES.includes(type); }

/** @returns {boolean} Whether the connection type is dual-stack (IPv4 + IPv6). */
function isDual(type) { return DUAL_TYPES.includes(type); }

/** @returns {boolean} Whether the connection type is IPv4 only. */
function isIpv4Only(type) { return IPV4_ONLY_TYPES.includes(type); }

/**
 * Build a random token from an alphabet using a cryptographically secure source.
 * Uses rejection sampling so the modulo reduction does not bias the output
 * toward the start of the alphabet.
 */
function randomToken(length, alphabet) {
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';
  while (out.length < length) {
    const bytes = crypto.randomBytes(length - out.length);
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      // Discard bytes in the biased tail to keep a uniform distribution.
      if (byte < max) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

/**
 * Generate a candidate PPPoE username, optionally seeded from a human-readable
 * value (e.g. a client name) for readability. Always suffixed with random
 * characters to keep usernames unique.
 */
function buildUsername(seed) {
  const base = String(seed || 'sub')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16) || 'sub';
  return `${base}-${randomToken(5, USERNAME_ALPHABET)}`;
}

/**
 * Generate a strong, human-friendly cleartext PPPoE password.
 */
function generatePassword(length = 14) {
  return randomToken(length, PASSWORD_ALPHABET);
}

/**
 * Generate a unique PPPoE username/password pair. The username is checked
 * against the radius table (including soft-deleted rows, since the column has a
 * UNIQUE constraint) and regenerated on collision.
 *
 * @param {object} runner DB pool or transaction connection exposing `.query`.
 * @param {object} [opts]
 * @param {string} [opts.seed] Optional readable seed for the username.
 * @returns {Promise<{username: string, password: string}>}
 */
async function generatePppoeCredentials(runner, { seed } = {}) {
  let username;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = buildUsername(seed);
    const [rows] = await runner.query(
      'SELECT id FROM radius WHERE username = ? LIMIT 1',
      [candidate],
    );
    if (rows.length === 0) {
      username = candidate;
      break;
    }
  }
  if (!username) {
    // Fall back to a longer random username that is statistically unique.
    username = `sub-${randomToken(12, USERNAME_ALPHABET)}`;
  }
  return { username, password: generatePassword() };
}

/**
 * Find the first active IP pool of a given version for an organization.
 *
 * @param {object} runner DB pool or transaction connection.
 * @param {object} opts
 * @param {'4'|'6'} opts.ipVersion
 * @param {number|null} opts.organizationId
 * @returns {Promise<number|null>} Pool id or null when none is configured.
 */
async function findActivePool(runner, { ipVersion, organizationId }) {
  const params = [String(ipVersion)];
  let orgClause = '';
  if (organizationId) {
    orgClause = ' AND (organization_id = ? OR organization_id IS NULL)';
    params.push(organizationId);
  }
  const [rows] = await runner.query(
    `SELECT id FROM ip_pools
       WHERE ip_version = ? AND status = 'active' AND deleted_at IS NULL${orgClause}
       ORDER BY id LIMIT 1`,
    params,
  );
  return rows[0] ? rows[0].id : null;
}

/**
 * Assert that an IP address is not already in active use by another contract or
 * IP assignment. Throws ConflictError on a duplicate.
 *
 * @param {object} runner DB pool or transaction connection.
 * @param {object} opts
 * @param {string} opts.ip The IPv4/IPv6 address to validate.
 * @param {number|null} [opts.organizationId]
 * @param {number|null} [opts.excludeContractId] Contract allowed to own the IP.
 */
async function assertIpAvailable(runner, { ip, organizationId = null, excludeContractId = null }) {
  if (!ip) return;

  // 1. Another contract already pins this static address.
  const contractParams = [ip];
  let contractSql = 'SELECT id FROM contracts WHERE ip_address = ? AND deleted_at IS NULL';
  if (organizationId) { contractSql += ' AND organization_id = ?'; contractParams.push(organizationId); }
  if (excludeContractId) { contractSql += ' AND id <> ?'; contractParams.push(excludeContractId); }
  contractSql += ' LIMIT 1';
  const [contractRows] = await runner.query(contractSql, contractParams);
  if (contractRows.length > 0) {
    throw new ConflictError(`IP address ${ip} is already assigned to another contract`);
  }

  // 2. An active IP-assignment record already holds this address.
  const assignParams = [ip];
  let assignSql = "SELECT id FROM ip_assignments WHERE ip_address = ? AND deleted_at IS NULL AND status <> 'expired'";
  if (organizationId) { assignSql += ' AND organization_id = ?'; assignParams.push(organizationId); }
  if (excludeContractId) { assignSql += ' AND (contract_id IS NULL OR contract_id <> ?)'; assignParams.push(excludeContractId); }
  assignSql += ' LIMIT 1';
  const [assignRows] = await runner.query(assignSql, assignParams);
  if (assignRows.length > 0) {
    throw new ConflictError(`IP address ${ip} is already in use`);
  }
}

/**
 * Provision the network resources for a freshly created contract.
 *  - PPPoE / PPPoE-dual: create a RADIUS account with generated credentials
 *    (and an IPv6 pool for dual-stack), returning the cleartext password.
 *  - static / dual: validate the static IPv4 address is not a duplicate.
 *
 * @param {object} runner DB pool or transaction connection.
 * @param {object} contract The persisted contract row (must include id,
 *   client_id, connection_type; optional ip_address, organization_id).
 * @param {object} [opts]
 * @param {string} [opts.seed] Optional readable username seed (e.g. client name).
 * @returns {Promise<object>} Provisioning summary.
 */
async function provisionNewContract(runner, contract, { seed } = {}) {
  const result = { connection_type: contract.connection_type };
  const organizationId = contract.organization_id ?? null;

  if (isPppoe(contract.connection_type)) {
    const { username, password } = await generatePppoeCredentials(runner, { seed });
    const ipv4PoolId = await findActivePool(runner, { ipVersion: '4', organizationId });
    const ipv6PoolId = isDual(contract.connection_type)
      ? await findActivePool(runner, { ipVersion: '6', organizationId })
      : null;

    const [ins] = await runner.query(
      `INSERT INTO radius (client_id, contract_id, username, password, ipv4_pool_id, ipv6_pool_id, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [contract.client_id, contract.id, username, password, ipv4PoolId, ipv6PoolId],
    );

    result.pppoe = {
      radius_id: ins.insertId,
      username,
      password,
      ipv4_pool_id: ipv4PoolId,
      ipv6_pool_id: ipv6PoolId,
      ipv6_enabled: Boolean(ipv6PoolId) || isDual(contract.connection_type),
    };
    logger.info({ contractId: contract.id, username }, 'Provisioned PPPoE account for new contract');
  }

  // Track any static IP supplied on the contract and reject duplicates.
  if (contract.ip_address) {
    await assertIpAvailable(runner, { ip: contract.ip_address, organizationId, excludeContractId: contract.id });
    result.ip_tracked = contract.ip_address;
  }

  return result;
}

/**
 * Enable a new IPv6 line for a contract that is being upgraded from an
 * IPv4-only connection type to a dual-stack one (IPv4 -> DUAL).
 *
 * For PPPoE accounts this attaches an IPv6 pool to the existing RADIUS account
 * (so the subscriber receives an IPv6 address / delegated prefix on the next
 * session) without disturbing the IPv4 configuration. For static services it
 * simply reports that the dual-stack upgrade was recognised.
 *
 * @param {object} runner DB pool or transaction connection.
 * @param {object} contract Updated contract row (id, connection_type, ...).
 * @returns {Promise<object>} Summary describing what changed.
 */
async function enableIpv6Line(runner, contract) {
  const organizationId = contract.organization_id ?? null;
  const [radiusRows] = await runner.query(
    'SELECT id, ipv6_pool_id FROM radius WHERE contract_id = ? AND deleted_at IS NULL ORDER BY id LIMIT 1',
    [contract.id],
  );

  if (radiusRows.length === 0) {
    // Static dual-stack: no RADIUS account, the IPv6 line is a static address.
    return { ipv6_enabled: true, radius: false };
  }

  const radius = radiusRows[0];
  let ipv6PoolId = radius.ipv6_pool_id;
  if (!ipv6PoolId) {
    ipv6PoolId = await findActivePool(runner, { ipVersion: '6', organizationId });
  }

  await runner.query(
    'UPDATE radius SET ipv6_pool_id = ?, status = ? WHERE id = ?',
    [ipv6PoolId, 'active', radius.id],
  );

  logger.info({ contractId: contract.id, radiusId: radius.id, ipv6PoolId }, 'Enabled IPv6 line on dual-stack upgrade');
  return { ipv6_enabled: true, radius: true, radius_id: radius.id, ipv6_pool_id: ipv6PoolId };
}

/**
 * Determine whether a contract update is upgrading an IPv4-only service to a
 * dual-stack service (the "IPv4 -> DUAL" window change).
 */
function isIpv4ToDualUpgrade(oldType, newType) {
  return Boolean(oldType) && Boolean(newType)
    && isIpv4Only(oldType) && isDual(newType);
}

module.exports = {
  PPPOE_TYPES,
  DUAL_TYPES,
  IPV4_ONLY_TYPES,
  isPppoe,
  isDual,
  isIpv4Only,
  generatePassword,
  generatePppoeCredentials,
  findActivePool,
  assertIpAvailable,
  provisionNewContract,
  enableIpv6Line,
  isIpv4ToDualUpgrade,
};
