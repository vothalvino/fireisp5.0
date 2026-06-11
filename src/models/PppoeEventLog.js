// =============================================================================
// FireISP 5.0 — PppoeEventLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PppoeEventLog extends BaseModel {
  static get tableName() { return 'pppoe_event_logs'; }

  static get fillable() {
    return [
      'organization_id', 'nas_id', 'username', 'mac', 'stage', 'severity',
      'message', 'reason_code', 'logged_at',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return false; }
}

module.exports = PppoeEventLog;
