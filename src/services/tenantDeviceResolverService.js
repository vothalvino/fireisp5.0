// Resolve one device management IP without crossing a tenant boundary.
//
// Isolated tenant databases cannot presently participate in an atomic,
// install-wide uniqueness decision. Until FireISP has a primary canonical
// source-binding registry, the presence of any retained isolated database
// configuration disables trap attribution for the whole install. Unknown,
// ambiguous, or incomplete attribution is dropped before persistence.

'use strict';

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'tenantDeviceResolver' });
const { normalizeIpAddress } = require('../utils/ipAddress');

const ISOLATED_UNSUPPORTED_REASON = 'isolated_tenant_attribution_unsupported';
const MULTI_ORGANIZATION_UNSUPPORTED_REASON = 'multi_organization_attribution_unsupported';

async function activeIsolatedOrganizations(exec = db.query, { lock = false } = {}) {
  const [rows] = await exec(
    `SELECT odc.organization_id
       FROM organization_database_configs odc
      WHERE odc.isolation_mode = 'isolated'
      ORDER BY odc.organization_id${lock ? ' FOR UPDATE' : ''}`,
  );
  return rows.map(row => Number(row.organization_id)).filter(Number.isSafeInteger);
}

async function retainedOrganizations(exec = db.query, { lock = false } = {}) {
  const [rows] = await exec(
    `SELECT id FROM organizations ORDER BY id${lock ? ' FOR UPDATE' : ' LIMIT 2'}`,
  );
  return rows.map(row => Number(row.id)).filter(Number.isSafeInteger);
}

async function sharedMatches(ipAddress, exec = db.query, { lock = false } = {}) {
  const queryColumn = async (column) => {
    const [rows] = await exec(
      `SELECT d.id, d.organization_id, d.name, d.ip_address, d.ipv6_address,
              d.deleted_at AS device_deleted_at,
            o.status AS organization_status,
            o.deleted_at AS organization_deleted_at
       FROM devices d
       LEFT JOIN organizations o ON o.id = d.organization_id
      WHERE d.${column} = INET6_ATON(?)
      ORDER BY d.id ASC${lock ? ' FOR UPDATE' : ''}`,
      [ipAddress],
    );
    return rows;
  };
  // Keep the two equality ranges separate so each generated-column index can
  // provide an exact next-key lock. OR/index-merge is not a reliable lock
  // boundary for concurrent duplicate inserts.
  const primaryRows = await queryColumn('ip_address_bin');
  const ipv6Rows = await queryColumn('ipv6_address_bin');
  const byId = new Map();
  for (const row of [...primaryRows, ...ipv6Rows]) byId.set(Number(row.id), row);
  return [...byId.values()];
}

function resolutionFromMatches(matches) {
  const ownerIds = new Set(matches.map(row => Number(row.organization_id)));
  if (ownerIds.size !== 1) {
    return {
      device: null,
      matches: matches.length,
      ambiguous: ownerIds.size > 1,
      incomplete: false,
      reason: ownerIds.size > 1 ? 'ambiguous_source_ip' : 'source_ip_not_registered',
    };
  }
  const current = matches.filter(row => !row.device_deleted_at);
  if (current.length !== 1) {
    return {
      device: null,
      matches: matches.length,
      ambiguous: current.length > 1,
      incomplete: false,
      reason: current.length > 1 ? 'ambiguous_source_ip' : 'source_device_archived',
    };
  }
  const owner = current[0];
  if ((owner.organization_status !== undefined && owner.organization_status !== 'active')
      || owner.organization_deleted_at) {
    return {
      device: null,
      matches: matches.length,
      ambiguous: false,
      incomplete: false,
      reason: 'source_owner_inactive',
    };
  }
  const {
    organization_status: _organizationStatus,
    organization_deleted_at: _organizationDeletedAt,
    device_deleted_at: _deviceDeletedAt,
    ipv6_address: _ipv6Address,
    ...device
  } = owner;
  device.ip_address = normalizeIpAddress(device.ip_address);
  device.database_scope = 'primary';
  return {
    device,
    matches: matches.length,
    ambiguous: false,
    incomplete: false,
    reason: null,
  };
}

async function resolveWithExecutor(value, exec, { lock = false } = {}) {
  const ipAddress = normalizeIpAddress(value);
  const isolated = await activeIsolatedOrganizations(exec, { lock });
  if (isolated.length) {
    return {
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
      reason: ISOLATED_UNSUPPORTED_REASON,
    };
  }
  const organizations = await retainedOrganizations(exec, { lock });
  // No retained tenant means no install-owned source can be authoritative.
  // Do not scan orphaned device rows: a partially cleaned database must never
  // turn a stale row into a routable trap source.
  if (organizations.length === 0) {
    return {
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: false,
      reason: 'source_ip_not_registered',
    };
  }
  if (organizations.length > 1) {
    return {
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
      reason: MULTI_ORGANIZATION_UNSUPPORTED_REASON,
    };
  }
  return resolutionFromMatches(await sharedMatches(ipAddress, exec, { lock }));
}

async function resolveDeviceByIp(value) {
  try {
    if (typeof db.withPrimaryContext === 'function') {
      return await db.withPrimaryContext(() => resolveWithExecutor(value, db.query));
    }
    return await resolveWithExecutor(value, db.query);
  } catch (err) {
    logger.error({ err }, 'Authoritative device routing lookup failed; trap attribution will fail closed');
    return {
      device: null,
      matches: 0,
      ambiguous: false,
      incomplete: true,
      reason: 'source_attribution_unavailable',
    };
  }
}

/**
 * Recheck and lock source uniqueness inside the same primary transaction that
 * stores the trap and forwarding outbox. The caller supplies the active
 * primary transaction's execute function.
 */
async function lockSharedDeviceByIp(value, exec) {
  if (typeof exec !== 'function') throw new TypeError('A transaction executor is required');
  return resolveWithExecutor(value, exec, { lock: true });
}

// Compatibility hook retained for device CRUD call sites. No positive routing
// result or isolated-tenant connection is cached by this service.
function invalidateDeviceRoutingCache() {}

module.exports = {
  ISOLATED_UNSUPPORTED_REASON,
  MULTI_ORGANIZATION_UNSUPPORTED_REASON,
  resolveDeviceByIp,
  lockSharedDeviceByIp,
  activeIsolatedOrganizations,
  retainedOrganizations,
  invalidateDeviceRoutingCache,
};
