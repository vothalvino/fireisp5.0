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
  connection_logs: {
    defaultDays: 730,
    defaultMonths: 24,
    monthsEnv: 'RADIUS_ACCOUNTING_RETENTION_MONTHS',
    dateColumn: 'retention_at',
    tenantWhere: '`organization_id` = ?',
    extraWhere: `NOT EXISTS (
      SELECT 1 FROM ip_attribution_case_evidence held
       WHERE held.organization_id = connection_logs.organization_id
         AND held.connection_log_id = connection_logs.id
         AND held.hold_released_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM cgnat_attribution_bindings binding
       WHERE binding.organization_id = connection_logs.organization_id
         AND binding.connection_log_id = connection_logs.id
    )`,
  },
  radius_accounting_events: {
    defaultDays: 730,
    defaultMonths: 24,
    monthsEnv: 'RADIUS_ACCOUNTING_RETENTION_MONTHS',
    dateColumn: 'event_at',
    tenantWhere: '`organization_id` = ?',
    extraWhere: `NOT EXISTS (
      SELECT 1 FROM ip_attribution_case_evidence held
       WHERE held.organization_id = radius_accounting_events.organization_id
         AND held.connection_log_id = radius_accounting_events.connection_log_id
         AND held.hold_released_at IS NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM cgnat_attribution_bindings binding
       WHERE binding.organization_id = radius_accounting_events.organization_id
         AND binding.session_instance_id = radius_accounting_events.session_instance_id
    )`,
  },
  radius_accounting_usage_daily: {
    defaultDays: 730,
    defaultMonths: 24,
    monthsEnv: 'RADIUS_ACCOUNTING_RETENTION_MONTHS',
    dateColumn: 'usage_date',
    tenantWhere: '`organization_id` = ?',
  },
  collector_ingest_receipts: {
    defaultDays: 90,
    dateColumn: 'last_received_at',
    tenantWhere: '`organization_id` = ?',
  },
  cgnat_binding_events: {
    defaultDays: 730,
    defaultMonths: 24,
    monthsEnv: 'CGNAT_ATTRIBUTION_RETENTION_MONTHS',
    maxDays: 730,
    maxMonths: 24,
    dateColumn: 'received_at',
    dateExpression: `(SELECT closed_binding.released_at
      FROM cgnat_attribution_bindings closed_binding
      WHERE closed_binding.organization_id = cgnat_binding_events.organization_id
        AND closed_binding.id = cgnat_binding_events.binding_id)`,
    tenantWhere: '`organization_id` = ?',
    extraWhere: `EXISTS (
      SELECT 1 FROM cgnat_attribution_bindings closed_binding
       WHERE closed_binding.organization_id = cgnat_binding_events.organization_id
         AND closed_binding.id = cgnat_binding_events.binding_id
         AND closed_binding.released_at IS NOT NULL
    ) AND NOT EXISTS (
      SELECT 1 FROM ip_attribution_case_evidence held
       WHERE held.organization_id = cgnat_binding_events.organization_id
         AND held.binding_id = cgnat_binding_events.binding_id
         AND held.hold_released_at IS NULL
    )`,
  },
  cgnat_attribution_bindings: {
    defaultDays: 730,
    defaultMonths: 24,
    monthsEnv: 'CGNAT_ATTRIBUTION_RETENTION_MONTHS',
    maxDays: 730,
    maxMonths: 24,
    dateColumn: 'released_at',
    tenantWhere: '`organization_id` = ?',
    extraWhere: `released_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM ip_attribution_case_evidence held
       WHERE held.organization_id = cgnat_attribution_bindings.organization_id
         AND held.binding_id = cgnat_attribution_bindings.id
         AND held.hold_released_at IS NULL
    )`,
  },
  ip_attribution_case_evidence: {
    defaultDays: 730,
    defaultMonths: 24,
    monthsEnv: 'CGNAT_ATTRIBUTION_RETENTION_MONTHS',
    maxDays: 730,
    maxMonths: 24,
    // Releasing a hold resumes the original retention clock; it must not grant
    // a fresh retention period to an already-old evidence snapshot.
    dateColumn: 'pinned_at',
    tenantWhere: '`organization_id` = ?',
    extraWhere: 'hold_released_at IS NOT NULL',
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
    const config = POLICY_CONFIG[table];
    const envKey = `RETENTION_${table.toUpperCase()}_DAYS`;
    const envVal = process.env[envKey];

    if (config.monthsEnv && process.env[config.monthsEnv] !== undefined
        && process.env[config.monthsEnv].trim() !== '') {
      const configuredMonths = parsePositiveInteger(process.env[config.monthsEnv]);
      if (!configuredMonths) {
        logger.warn(
          { envKey: config.monthsEnv, configuredValue: process.env[config.monthsEnv], defaultDays },
          'Invalid retention period; using safe default',
        );
        policies[table] = defaultDays;
      } else {
        const effectiveMonths = config.maxMonths
          ? Math.min(configuredMonths, config.maxMonths)
          : configuredMonths;
        if (effectiveMonths !== configuredMonths) {
          logger.warn(
            { envKey: config.monthsEnv, configuredMonths, maxMonths: config.maxMonths },
            'Retention period exceeds the supported maximum; using the maximum',
          );
        }
        policies[table] = effectiveMonths * 30;
      }
      continue;
    }

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

    if (config.maxDays && configuredDays > config.maxDays) {
      logger.warn(
        { envKey, configuredDays, maxDays: config.maxDays },
        'Retention period exceeds the supported maximum; using the maximum',
      );
      policies[table] = config.maxDays;
    } else {
      policies[table] = configuredDays;
    }
  }
  return policies;
}

function loadPolicySpecs() {
  const dayPolicies = loadPolicies();
  return Object.fromEntries(Object.entries(dayPolicies).map(([table, days]) => {
    const config = POLICY_CONFIG[table];
    if (!config.monthsEnv) return [table, { value: days, unit: 'DAY' }];
    const dayEnv = process.env[`RETENTION_${table.toUpperCase()}_DAYS`];
    const monthEnv = process.env[config.monthsEnv];
    if ((monthEnv === undefined || monthEnv.trim() === '')
        && dayEnv !== undefined && dayEnv.trim() !== '') {
      return [table, { value: days, unit: 'DAY' }];
    }
    const parsed = parsePositiveInteger(monthEnv);
    const months = parsed
      ? Math.min(parsed, config.maxMonths || Number.MAX_SAFE_INTEGER)
      : config.defaultMonths;
    return [table, { value: months, unit: 'MONTH' }];
  }));
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
  const extraClause = config.extraWhere ? ` AND (${config.extraWhere})` : '';
  const params = tenantScoped
    ? [effectiveRetentionDays, organizationId]
    : [effectiveRetentionDays];
  const dateExpression = config.dateExpression || `\`${effectiveDateColumn}\``;

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
      `DELETE FROM \`${table}\` WHERE ${dateExpression} < DATE_SUB(NOW(), INTERVAL ? DAY)${tenantClause}${extraClause} LIMIT ${DELETE_BATCH_SIZE}`,
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

async function purgeTableMonths(table, retentionMonths, options = {}) {
  const config = POLICY_CONFIG[table];
  if (!config?.monthsEnv) throw new Error(`Table "${table}" does not support month retention`);
  const months = parsePositiveInteger(retentionMonths);
  if (!months || (config.maxMonths && months > config.maxMonths)) {
    throw new Error('retentionMonths must be within the supported positive range');
  }
  const tenantScoped = Object.prototype.hasOwnProperty.call(options || {}, 'organizationId');
  const organizationId = tenantScoped ? normalizeOrganizationId(options.organizationId) : null;
  const tenantClause = tenantScoped ? ` AND ${config.tenantWhere}` : '';
  const extraClause = config.extraWhere ? ` AND (${config.extraWhere})` : '';
  const params = tenantScoped ? [months, organizationId] : [months];
  const dateExpression = config.dateExpression || `\`${config.dateColumn}\``;
  let totalDeleted = 0;
  while (true) {
    const [result] = await db.query(
      `DELETE FROM \`${table}\` WHERE ${dateExpression} < DATE_SUB(NOW(), INTERVAL ? MONTH)${tenantClause}${extraClause} LIMIT ${DELETE_BATCH_SIZE}`,
      params,
    );
    totalDeleted += result.affectedRows;
    if (result.affectedRows < DELETE_BATCH_SIZE) break;
  }
  return { table, deleted: totalDeleted };
}

async function runPoliciesForCurrentDatabase({
  policies,
  databaseScope,
  organizationId = null,
  tenantScoped = false,
}) {
  const results = [];

  for (const [table, policy] of Object.entries(policies)) {
    try {
      const result = policy?.unit === 'MONTH'
        ? await purgeTableMonths(table, policy.value, tenantScoped ? { organizationId } : {})
        : await purgeTable(table, policy?.value ?? policy, POLICY_CONFIG[table].dateColumn,
          tenantScoped ? { organizationId } : {});
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
        WHERE odc.isolation_mode = 'isolated'
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
async function runWithPolicies(options, policies) {
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

async function runAll(options = {}) {
  return runWithPolicies(options, loadPolicySpecs());
}

const CONNECTION_LOGGING_TABLES = Object.freeze([
  'connection_logs',
  'radius_accounting_events',
  'radius_accounting_usage_daily',
  'collector_ingest_receipts',
  'cgnat_binding_events',
  'cgnat_attribution_bindings',
  'ip_attribution_case_evidence',
]);

// Scheduled general retention must be disjoint from the dedicated connection
// logging task. runAll remains available for explicit all-data/secure-deletion
// workflows that intentionally cover every policy in one invocation.
async function runGeneral(options = {}) {
  const all = loadPolicySpecs();
  const selected = Object.fromEntries(
    Object.entries(all).filter(([table]) => !CONNECTION_LOGGING_TABLES.includes(table)),
  );
  return runWithPolicies(options, selected);
}

async function runConnectionLogging(options = {}) {
  const all = loadPolicySpecs();
  const selected = Object.fromEntries(
    CONNECTION_LOGGING_TABLES
      .map(table => [table, all[table]]),
  );
  return runWithPolicies(options, selected);
}

module.exports = {
  runAll,
  runGeneral,
  runConnectionLogging,
  purgeTable,
  purgeTableMonths,
  loadPolicies,
  loadPolicySpecs,
  DEFAULT_POLICIES,
  CONNECTION_LOGGING_TABLES,
};
