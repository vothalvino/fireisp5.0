// =============================================================================
// FireISP 5.0 — Data Retention Service
// =============================================================================
// Configurable TTL-based purge for high-volume tables that grow unbounded.
// Registered as a scheduled task to run periodically.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'retention' });

const DELETE_BATCH_SIZE = 1000;

/**
 * Retention metadata is kept in one whitelist so table/column identifiers and
 * tenant predicates can never be supplied by a caller.
 */
const POLICY_CONFIG = Object.freeze({
  audit_logs: {
    defaultDays: 365,
    dateColumn: 'created_at',
    tenantWhere: '`organization_id` = ?',
  },
  alert_events: {
    defaultDays: 90,
    dateColumn: 'created_at',
    tenantWhere: '`organization_id` = ?',
  },
  webhook_deliveries: {
    defaultDays: 90,
    dateColumn: 'created_at',
    tenantWhere: '`webhook_id` IN (SELECT `id` FROM `webhooks` WHERE `organization_id` = ?)',
  },
  email_logs: {
    defaultDays: 180,
    dateColumn: 'created_at',
    tenantWhere: '`organization_id` = ?',
  },
  sms_logs: {
    defaultDays: 180,
    dateColumn: 'created_at',
    tenantWhere: '`organization_id` = ?',
  },
  idempotency_keys: {
    defaultDays: 7,
    dateColumn: 'expires_at',
    tenantWhere: '`organization_id` = ?',
  },
  radpostauth: {
    defaultDays: 90,
    dateColumn: 'authdate',
    tenantWhere: '`organization_id` = ?',
  },
  pppoe_event_logs: {
    defaultDays: 90,
    dateColumn: 'logged_at',
    tenantWhere: '`organization_id` = ?',
  },
});

/**
 * Default retention policies (in days). Override via environment variables.
 */
const DEFAULT_POLICIES = Object.freeze(
  Object.fromEntries(
    Object.entries(POLICY_CONFIG).map(([table, config]) => [table, config.defaultDays]),
  ),
);

function parsePositiveInteger(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeOrganizationId(value) {
  const organizationId = parsePositiveInteger(
    typeof value === 'string' ? value.trim() : value,
  );
  if (!organizationId) {
    throw new Error('organizationId must be a positive integer');
  }
  return organizationId;
}

/**
 * Load retention policies from environment or use defaults.
 * Environment variable format: RETENTION_<TABLE>_DAYS (e.g. RETENTION_AUDIT_LOGS_DAYS=180)
 */
function loadPolicies() {
  const policies = {};
  for (const [table, defaultDays] of Object.entries(DEFAULT_POLICIES)) {
    const envKey = `RETENTION_${table.toUpperCase()}_DAYS`;
    const envVal = process.env[envKey];

    if (envVal === undefined || envVal.trim() === '') {
      policies[table] = defaultDays;
      continue;
    }

    const configuredDays = parsePositiveInteger(envVal);
    if (!configuredDays) {
      logger.warn(
        { envKey, configuredValue: envVal, defaultDays },
        'Invalid retention period; using safe default',
      );
      policies[table] = defaultDays;
      continue;
    }

    policies[table] = configuredDays;
  }
  return policies;
}

/**
 * Purge old records from a single table.
 * Uses batched deletes to avoid long-running transactions.
 *
 * @param {string} table - Table name (must be in DEFAULT_POLICIES)
 * @param {number} retentionDays - Number of days to retain
 * @param {string} [dateColumn] - Whitelisted column to check age against
 * @param {{ organizationId?: number }} [options] - Optional strict tenant scope
 * @returns {{ table: string, deleted: number }}
 */
async function purgeTable(table, retentionDays, dateColumn, options = {}) {
  const config = POLICY_CONFIG[table];
  if (!config) {
    throw new Error(`Table "${table}" is not in the retention policy whitelist`);
  }

  const effectiveDateColumn = dateColumn || config.dateColumn;
  if (effectiveDateColumn !== config.dateColumn) {
    throw new Error(`Column "${effectiveDateColumn}" is not valid for retention table "${table}"`);
  }

  const effectiveRetentionDays = parsePositiveInteger(retentionDays);
  if (!effectiveRetentionDays) {
    throw new Error('retentionDays must be a positive integer');
  }

  const tenantScoped = options !== null
    && typeof options === 'object'
    && Object.prototype.hasOwnProperty.call(options, 'organizationId');
  const organizationId = tenantScoped
    ? normalizeOrganizationId(options.organizationId)
    : null;
  const tenantClause = tenantScoped ? ` AND ${config.tenantWhere}` : '';
  const params = tenantScoped
    ? [effectiveRetentionDays, organizationId]
    : [effectiveRetentionDays];

  let totalDeleted = 0;

  logger.info(
    {
      table,
      retentionDays: effectiveRetentionDays,
      dateColumn: effectiveDateColumn,
      organizationId,
    },
    'Starting retention purge',
  );

  // Delete in batches to avoid locking the table for too long.
  while (true) {
    const [result] = await db.query(
      `DELETE FROM \`${table}\` WHERE \`${effectiveDateColumn}\` < DATE_SUB(NOW(), INTERVAL ? DAY)${tenantClause} LIMIT ${DELETE_BATCH_SIZE}`,
      params,
    );

    totalDeleted += result.affectedRows;

    if (result.affectedRows < DELETE_BATCH_SIZE) {
      break;
    }
  }

  logger.info({ table, deleted: totalDeleted, organizationId }, 'Retention purge completed');
  return { table, deleted: totalDeleted };
}

async function runPoliciesForCurrentDatabase({
  policies,
  databaseScope,
  organizationId = null,
  tenantScoped = false,
}) {
  const results = [];

  for (const [table, days] of Object.entries(policies)) {
    try {
      const result = await purgeTable(
        table,
        days,
        POLICY_CONFIG[table].dateColumn,
        tenantScoped ? { organizationId } : {},
      );
      results.push({
        ...result,
        database_scope: databaseScope,
        organization_id: organizationId,
      });
    } catch (err) {
      logger.error(
        { err, table, databaseScope, organizationId },
        'Retention purge failed for table',
      );
      results.push({
        table,
        deleted: 0,
        error: err.message,
        database_scope: databaseScope,
        organization_id: organizationId,
      });
    }
  }

  return {
    total_deleted: results.reduce((sum, result) => sum + (result.deleted || 0), 0),
    tables: results,
    table_errors: results.filter(result => result.error).length,
  };
}

async function listIsolatedOrganizationIds() {
  return db.withPrimaryContext(async () => {
    const [rows] = await db.query(
      `SELECT odc.organization_id
         FROM organization_database_configs odc
         JOIN organizations o ON o.id = odc.organization_id
        WHERE odc.isolation_mode = 'isolated'
          AND o.status = 'active'
          AND o.deleted_at IS NULL
        ORDER BY odc.organization_id`,
    );

    return rows.map(row => normalizeOrganizationId(row.organization_id));
  });
}

function scopeSummary(databaseScope, organizationId, result) {
  return {
    database_scope: databaseScope,
    organization_id: organizationId,
    total_deleted: result.total_deleted,
    tables: result.tables.length,
    table_errors: result.table_errors,
    status: result.table_errors > 0 ? 'partial' : 'ok',
  };
}

/**
 * Run all configured retention policies.
 *
 * With an organizationId, this is a strictly tenant-scoped purge used by the
 * manual secure-deletion endpoint. Without one, it is the install-wide
 * scheduled sweep: primary first, then every configured isolated tenant DB.
 * Each database scope is isolated so one unavailable tenant does not prevent
 * retention from running for the remaining tenants.
 *
 * @param {{ organizationId?: number }} [options]
 * @returns {{ total_deleted: number, tables: Array, database_scopes: Array, scope_failures: Array }}
 */
async function runAll(options = {}) {
  const policies = loadPolicies();
  const tenantRun = options !== null
    && typeof options === 'object'
    && Object.prototype.hasOwnProperty.call(options, 'organizationId');

  if (tenantRun) {
    const organizationId = normalizeOrganizationId(options.organizationId);
    const result = await db.withTenantContext(
      organizationId,
      () => runPoliciesForCurrentDatabase({
        policies,
        databaseScope: 'tenant',
        organizationId,
        tenantScoped: true,
      }),
    );

    return {
      total_deleted: result.total_deleted,
      tables: result.tables,
      database_scopes: [scopeSummary('tenant', organizationId, result)],
      scope_failures: [],
    };
  }

  const tables = [];
  const databaseScopes = [];
  const scopeFailures = [];
  let isolatedOrganizationIds = [];

  try {
    isolatedOrganizationIds = await listIsolatedOrganizationIds();
  } catch (err) {
    logger.error({ err }, 'Failed to discover isolated tenant databases for retention');
    scopeFailures.push({ database_scope: 'isolated_discovery', error: err.message });
  }

  try {
    const primaryResult = await db.withPrimaryContext(
      () => runPoliciesForCurrentDatabase({ policies, databaseScope: 'primary' }),
    );
    tables.push(...primaryResult.tables);
    databaseScopes.push(scopeSummary('primary', null, primaryResult));
  } catch (err) {
    logger.error({ err }, 'Retention failed for primary database scope');
    scopeFailures.push({ database_scope: 'primary', organization_id: null, error: err.message });
  }

  for (const organizationId of isolatedOrganizationIds) {
    try {
      // Keep an explicit organization predicate even inside an isolated DB.
      // Database routing intentionally falls back to primary for shared tenants;
      // this predicate makes a stale isolation config fail safely.
      const isolatedResult = await db.withTenantContext(
        organizationId,
        () => runPoliciesForCurrentDatabase({
          policies,
          databaseScope: 'isolated',
          organizationId,
          tenantScoped: true,
        }),
      );
      tables.push(...isolatedResult.tables);
      databaseScopes.push(scopeSummary('isolated', organizationId, isolatedResult));
    } catch (err) {
      logger.error(
        { err, organizationId },
        'Retention failed for isolated tenant database scope',
      );
      scopeFailures.push({
        database_scope: 'isolated',
        organization_id: organizationId,
        error: err.message,
      });
    }
  }

  const totalDeleted = tables.reduce((sum, result) => sum + (result.deleted || 0), 0);
  logger.info(
    {
      totalDeleted,
      tables: tables.length,
      databaseScopes: databaseScopes.length,
      scopeFailures: scopeFailures.length,
    },
    'All retention policies executed',
  );

  return {
    total_deleted: totalDeleted,
    tables,
    database_scopes: databaseScopes,
    scope_failures: scopeFailures,
  };
}

module.exports = { runAll, purgeTable, loadPolicies, DEFAULT_POLICIES };
