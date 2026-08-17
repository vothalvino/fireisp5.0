'use strict';

const db = require('../config/database');

const MIGRATION_FILENAME = '459_activate_snmp_trap_forwarding.sql';
const CACHE_TTL_MS = 5000;
const ISOLATED_UNSUPPORTED_REASON = 'isolated_tenant_attribution_unsupported';
const MULTI_ORGANIZATION_UNSUPPORTED_REASON = 'multi_organization_attribution_unsupported';

let cached = null;
let cacheExpiresAt = 0;

async function inPrimary(callback) {
  if (typeof db.withPrimaryContext === 'function') return db.withPrimaryContext(callback);
  return callback();
}

async function checkPrimarySchemaReadiness({ exec = null } = {}) {
  try {
    const run = async () => {
      const query = exec || db.query;
      const [migrations] = await query(
        'SELECT filename FROM schema_migrations WHERE filename = ? LIMIT 1',
        [MIGRATION_FILENAME],
      );
      if (!migrations[0]) {
        return { ready: false, reason: 'primary_schema_unavailable' };
      }
      const [columns] = await query(
        `SELECT COUNT(*) AS required_columns
           FROM information_schema.columns
          WHERE table_schema = DATABASE()
            AND (
              (table_name = 'snmp_trap_forwarding_deliveries'
                AND column_name IN ('id','claim_token','target_type','payload','recovery_count','organization_epoch','revoked_at'))
              OR (table_name = 'snmp_trap_forwarding_rules'
                AND column_name IN ('last_delivery_status','last_delivery_is_test','configuration_reviewed_at'))
              OR (table_name = 'devices'
                AND column_name IN ('ip_address_bin','ipv6_address_bin'))
              OR (table_name = 'snmp_traps'
                AND column_name IN ('varbinds_truncated','varbinds_original_count','varbinds_truncation_reason'))
              OR (table_name = 'snmp_trap_ingest_daily_usage'
                AND column_name IN ('usage_date','scope_type','scope_id','trap_count',
                  'varbind_bytes','delivery_count','metadata_only_count',
                  'dropped_trap_count','forwarding_skipped_count'))
              OR (table_name = 'webhook_deliveries'
                AND column_name IN ('organization_epoch','revoked_at'))
              OR (table_name = 'organizations'
                AND column_name = 'outbound_delivery_epoch')
            )`,
      );
      if (Number(columns[0]?.required_columns || 0) !== 27) {
        return { ready: false, reason: 'primary_schema_unavailable' };
      }
      return { ready: true, reason: null };
    };
    return exec ? await run() : await inPrimary(run);
  } catch (_err) {
    return { ready: false, reason: 'primary_schema_unavailable' };
  }
}

async function activeIsolatedOrganizations({ exec = null } = {}) {
  const run = async () => {
    const query = exec || db.query;
    const [rows] = await query(
      `SELECT odc.organization_id
         FROM organization_database_configs odc
        WHERE odc.isolation_mode = 'isolated'
        ORDER BY odc.organization_id`,
    );
    return rows.map(row => Number(row.organization_id)).filter(Number.isSafeInteger);
  };
  return exec ? run() : inPrimary(run);
}

async function retainedOrganizationIds({ exec = null } = {}) {
  const run = async () => {
    const query = exec || db.query;
    const [rows] = await query('SELECT id FROM organizations ORDER BY id LIMIT 2');
    return rows.map(row => Number(row.id)).filter(Number.isSafeInteger);
  };
  return exec ? run() : inPrimary(run);
}

async function checkSchemaReadiness({ force = false, exec = null } = {}) {
  const now = Date.now();
  if (!exec && !force && cached && cacheExpiresAt > now) return cached;

  const primary = await checkPrimarySchemaReadiness({ exec });
  let isolated = [];
  let reason = primary.reason;
  if (primary.ready) {
    try {
      isolated = await activeIsolatedOrganizations({ exec });
      if (isolated.length) reason = ISOLATED_UNSUPPORTED_REASON;
      if (!reason && (await retainedOrganizationIds({ exec })).length > 1) {
        reason = MULTI_ORGANIZATION_UNSUPPORTED_REASON;
      }
    } catch (_err) {
      reason = 'source_attribution_unavailable';
    }
  }

  const result = {
    ready: primary.ready && !reason,
    primary,
    isolated: isolated.map(organizationId => ({
      organization_id: organizationId,
      ready: false,
      reason: ISOLATED_UNSUPPORTED_REASON,
    })),
    reason: reason || null,
    checked_at: new Date(now).toISOString(),
  };
  if (!exec) {
    cached = result;
    cacheExpiresAt = now + CACHE_TTL_MS;
  }
  return result;
}

function invalidateSchemaReadinessCache() {
  cached = null;
  cacheExpiresAt = 0;
}

module.exports = {
  MIGRATION_FILENAME,
  ISOLATED_UNSUPPORTED_REASON,
  MULTI_ORGANIZATION_UNSUPPORTED_REASON,
  checkPrimarySchemaReadiness,
  checkSchemaReadiness,
  retainedOrganizationIds,
  invalidateSchemaReadinessCache,
};
