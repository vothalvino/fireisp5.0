// =============================================================================
// FireISP 5.0 — AuditLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class AuditLog extends BaseModel {
  static get tableName() { return 'audit_logs'; }
  static get fillable() { return ['organization_id', 'user_id', 'action', 'entity_type', 'entity_id', 'old_values', 'new_values', 'ip_address']; }
  static get hasOrgScope() { return true; }
}

module.exports = AuditLog;
