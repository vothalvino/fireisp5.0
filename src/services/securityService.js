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
        await db.query(
          `INSERT INTO secure_deletion_log
            (organization_id, table_name, records_deleted, deletion_reason, triggered_by, completed_at, details)
           VALUES (?, ?, ?, ?, ?, NOW(), ?)`,
          [
            organizationId,
            tableResult.table,
            tableResult.deleted,
            'retention_policy',
            'system',
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
