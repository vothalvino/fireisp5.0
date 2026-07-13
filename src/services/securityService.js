// =============================================================================
// FireISP 5.0 — Security Service (§17)
// =============================================================================
// Provides secure deletion of expired data and related security operations.
// =============================================================================

const db = require('../config/database');
const retentionService = require('./retentionService');
const logger = require('../utils/logger').child({ service: 'security' });

/**
 * Run secure deletion of expired retention data for an organization.
 * Calls retentionService.runAll() to purge expired records, then logs
 * the operation to secure_deletion_log.
 *
 * @param {number} organizationId
 * @returns {{ total_deleted: number, tables: Array, logged: boolean }}
 */
async function runSecureDeletion(organizationId) {
  logger.info({ organizationId }, 'Starting secure deletion run');

  const retentionResults = await retentionService.runAll();
  const { total_deleted, tables } = retentionResults;

  // Log each table purge to secure_deletion_log
  for (const tableResult of tables) {
    if (tableResult.deleted > 0) {
      try {
        // Real columns are record_count / reason / requestor_type / deleted_at /
        // criteria — `records_deleted`, `deletion_reason`, `triggered_by`,
        // `completed_at` and `details` do not exist (database/schema.sql).
        await db.query(
          `INSERT INTO secure_deletion_log
            (organization_id, table_name, record_count, deletion_method, reason,
             requestor_type, criteria, deleted_at)
           VALUES (?, ?, ?, 'hard_delete', ?, 'retention_policy', ?, NOW())`,
          [
            organizationId,
            tableResult.table,
            tableResult.deleted,
            'retention_policy',
            JSON.stringify({ error: tableResult.error || null }),
          ],
        );
      } catch (logErr) {
        logger.error({ logErr, table: tableResult.table }, 'Failed to write secure deletion log entry');
      }
    }
  }

  logger.info({ organizationId, total_deleted, tables: tables.length }, 'Secure deletion run completed');

  return {
    total_deleted,
    tables,
    logged: true,
  };
}

module.exports = { runSecureDeletion };
