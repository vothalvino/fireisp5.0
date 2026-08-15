// Resolve a NAS across shared and isolated tenant databases without performing
// an O(tenant-count) fan-out for every RADIUS packet. The cache contains only
// routing descriptors (never shared secrets); the selected secret is read from
// its owning database at request time. Ambiguity and incomplete initial scans
// fail closed.

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'tenantNasResolver' });

const CACHE_TTL_MS = Math.min(Math.max(
  Number.parseInt(process.env.RADIUS_NAS_ROUTE_CACHE_SECONDS || '10', 10) || 10, 1,
), 60) * 1000;
let snapshot = null;
let refreshPromise = null;

async function isolatedOrganizationIds() {
  return db.withPrimaryContext(async () => {
    const [rows] = await db.query(
      `SELECT odc.organization_id
         FROM organization_database_configs odc
         JOIN organizations o ON o.id = odc.organization_id
        WHERE odc.isolation_mode = 'isolated'
          AND o.status = 'active' AND o.deleted_at IS NULL
        ORDER BY odc.organization_id`,
    );
    return rows.map(row => Number(row.organization_id)).filter(Number.isSafeInteger);
  });
}

function addDescriptors(map, rows, databaseScope) {
  for (const row of rows) {
    const descriptor = {
      id: row.id,
      organization_id: row.organization_id,
      ip_address: row.ip_address,
      database_scope: databaseScope,
    };
    const list = map.get(row.ip_address) || [];
    list.push(descriptor);
    map.set(row.ip_address, list);
  }
}

async function buildSnapshot() {
  const byIp = new Map();
  await db.withPrimaryContext(async () => {
    const [rows] = await db.query(
      `SELECT n.id, n.organization_id, n.ip_address
         FROM nas n
        WHERE n.status = 'active' AND n.organization_id IS NOT NULL
          AND n.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM organization_database_configs odc
             WHERE odc.organization_id = n.organization_id
               AND odc.isolation_mode = 'isolated'
          )`,
    );
    addDescriptors(byIp, rows, 'primary');
  });

  const isolatedIds = await isolatedOrganizationIds();
  await Promise.all(isolatedIds.map(async organizationId => {
    await db.withTenantContext(organizationId, async () => {
      const [rows] = await db.query(
        `SELECT n.id, n.organization_id, n.ip_address
           FROM nas n
          WHERE n.organization_id = ? AND n.status = 'active'
            AND n.deleted_at IS NULL`,
        [organizationId],
      );
      addDescriptors(byIp, rows, 'isolated');
    });
  }));
  return { byIp, refreshedAt: Date.now() };
}

async function refreshSnapshot() {
  if (!refreshPromise) {
    refreshPromise = buildSnapshot()
      .then(next => { snapshot = next; return next; })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

function invalidateNasRoutingCache() {
  snapshot = null;
}

async function currentSnapshot() {
  const now = Date.now();
  if (!snapshot || now - snapshot.refreshedAt > CACHE_TTL_MS) {
    try {
      return await refreshSnapshot();
    } catch (err) {
      logger.error({ err }, 'NAS routing descriptor refresh failed');
      // Ownership/ambiguity cannot be proven while any configured database
      // scope is unavailable. Compatibility source-IP resolution therefore
      // fails closed; isolated installations should use the organization-bound
      // collector endpoint instead of accepting a stale cross-tenant mapping.
      return null;
    }
  }
  return snapshot;
}

async function fetchSecret(descriptor) {
  const read = async () => {
    const [rows] = await db.query(
      `SELECT id, organization_id, ip_address, secret
         FROM nas WHERE id = ? AND organization_id = ? AND ip_address = ?
          AND status = 'active' AND deleted_at IS NULL LIMIT 1`,
      [descriptor.id, descriptor.organization_id, descriptor.ip_address],
    );
    return rows[0] || null;
  };
  return descriptor.database_scope === 'isolated'
    ? db.withTenantContext(descriptor.organization_id, read)
    : db.withPrimaryContext(read);
}

async function resolveNasByIp(ipAddress, { includeSecret = false } = {}) {
  const current = await currentSnapshot();
  if (!current) return { nas: null, ambiguous: false, matches: 0, incomplete: true };
  const matches = current.byIp.get(ipAddress) || [];
  if (matches.length !== 1) {
    return { nas: null, ambiguous: matches.length > 1, matches: matches.length, incomplete: false };
  }
  const descriptor = matches[0];
  const nas = includeSecret ? await fetchSecret(descriptor) : descriptor;
  return {
    nas: nas ? { ...descriptor, ...nas } : null,
    ambiguous: false,
    matches: nas ? 1 : 0,
    incomplete: false,
  };
}

module.exports = {
  resolveNasByIp,
  isolatedOrganizationIds,
  invalidateNasRoutingCache,
  _refreshSnapshot: refreshSnapshot,
};
