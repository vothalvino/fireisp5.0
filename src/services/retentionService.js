// =============================================================================
// FireISP 5.0 — Data Retention Service
// =============================================================================
// Configurable TTL-based purge for high-volume tables that grow unbounded.
// Registered as a scheduled task to run periodically.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger').child({ service: 'retention' });

/**
 * Default retention policies (in days). Override via environment variables.
 */
const DEFAULT_POLICIES = {
  audit_logs: 365,
  alert_events: 90,
  webhook_deliveries: 90,
  email_logs: 180,
  sms_logs: 180,
  idempotency_keys: 7,
};

/**
 * Load retention policies from environment or use defaults.
 * Environment variable format: RETENTION_<TABLE>_DAYS (e.g. RETENTION_AUDIT_LOGS_DAYS=180)
 */
function loadPolicies() {
  const policies = {};
  for (const [table, defaultDays] of Object.entries(DEFAULT_POLICIES)) {
    const envKey = `RETENTION_${table.toUpperCase()}_DAYS`;
    const envVal = process.env[envKey];
    policies[table] = envVal ? parseInt(envVal, 10) : defaultDays;
  }
  return policies;
}

/**
 * Purge old records from a single table.
 * Uses batched deletes to avoid long-running transactions.
 *
 * @param {string} table - Table name (must be in DEFAULT_POLICIES)
 * @param {number} retentionDays - Number of days to retain
 * @param {string} [dateColumn='created_at'] - Column to check age against
 * @returns {{ table: string, deleted: number }}
 */
async function purgeTable(table, retentionDays, dateColumn = 'created_at') {
  // Whitelist of purgeable tables to prevent injection
  if (!DEFAULT_POLICIES[table]) {
    throw new Error(`Table "${table}" is not in the retention policy whitelist`);
  }

  const batchSize = 1000;
  let totalDeleted = 0;

  logger.info({ table, retentionDays, dateColumn }, 'Starting retention purge');

  // Delete in batches to avoid locking the table for too long
  while (true) {
    const [result] = await db.query(
      `DELETE FROM \`${table}\` WHERE \`${dateColumn}\` < DATE_SUB(NOW(), INTERVAL ? DAY) LIMIT ?`,
      [retentionDays, batchSize],
    );

    totalDeleted += result.affectedRows;

    if (result.affectedRows < batchSize) {
      break; // No more rows to delete
    }
  }

  logger.info({ table, deleted: totalDeleted }, 'Retention purge completed');
  return { table, deleted: totalDeleted };
}

/**
 * Run all configured retention policies.
 * Returns a summary of rows deleted per table.
 */
async function runAll() {
  const policies = loadPolicies();
  const results = [];

  // Table → date column mapping (most tables use created_at)
  const dateColumns = {
    audit_logs: 'created_at',
    alert_events: 'created_at',
    webhook_deliveries: 'created_at',
    email_logs: 'created_at',
    sms_logs: 'created_at',
    idempotency_keys: 'expires_at',
  };

  for (const [table, days] of Object.entries(policies)) {
    try {
      const result = await purgeTable(table, days, dateColumns[table] || 'created_at');
      results.push(result);
    } catch (err) {
      logger.error({ err, table }, 'Retention purge failed for table');
      results.push({ table, deleted: 0, error: err.message });
    }
  }

  const totalDeleted = results.reduce((sum, r) => sum + (r.deleted || 0), 0);
  logger.info({ totalDeleted, tables: results.length }, 'All retention policies executed');

  return { total_deleted: totalDeleted, tables: results };
}

module.exports = { runAll, purgeTable, loadPolicies, DEFAULT_POLICIES };
