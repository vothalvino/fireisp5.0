// =============================================================================
// FireISP 5.0 — SecureDeletionLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SecureDeletionLog extends BaseModel {
  static get tableName() { return 'secure_deletion_log'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'table_name', 'records_deleted', 'deletion_reason', 'triggered_by', 'completed_at', 'details'];
  }
}

module.exports = SecureDeletionLog;
