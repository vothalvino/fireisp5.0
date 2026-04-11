// =============================================================================
// FireISP 5.0 — ConnectionLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ConnectionLog extends BaseModel {
  static get tableName() { return 'connection_logs'; }
  static get fillable() { return ['radius_id', 'nas_id', 'session_id', 'ip_address', 'event_type', 'bytes_in', 'bytes_out', 'session_time', 'terminate_cause']; }
  static get hasOrgScope() { return false; }
}

module.exports = ConnectionLog;
