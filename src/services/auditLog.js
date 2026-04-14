// =============================================================================
// FireISP 5.0 — Audit Log Service
// =============================================================================
// Records who changed what and when into the audit_logs table.
// =============================================================================

const db = require('../config/database');
const logger = require('../utils/logger');

/**
 * Log an audit event.
 *
 * @param {object} params
 * @param {number} params.userId       - The user who performed the action
 * @param {number} [params.organizationId] - The org context
 * @param {string} params.action       - 'create', 'update', 'delete'
 * @param {string} params.tableName    - The affected table
 * @param {number} params.recordId     - The affected record's ID
 * @param {object} [params.oldValues]  - Previous values (for update/delete)
 * @param {object} [params.newValues]  - New values (for create/update)
 */
async function log({ userId, organizationId, action, tableName, recordId, oldValues, newValues }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, organization_id, action, table_name, record_id, old_values, new_values)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId || null,
        organizationId || null,
        action,
        tableName,
        recordId,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
      ],
    );
  } catch (err) {
    // Audit logging should never crash the request
    logger.error({ err }, 'Audit log error');
  }
}

module.exports = { log };
