// =============================================================================
// FireISP 5.0 — SuspensionLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SuspensionLog extends BaseModel {
  static get tableName() { return 'suspension_logs'; }
  static get fillable() { return ['organization_id', 'contract_id', 'rule_id', 'action', 'triggered_by', 'notes']; }
  static get hasOrgScope() { return true; }
}

module.exports = SuspensionLog;
