// =============================================================================
// FireISP 5.0 — ConnectionLog Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ConnectionLog extends BaseModel {
  static get tableName() { return 'connection_logs'; }
  static get fillable() {
    return [
      'organization_id', 'radius_id', 'nas_id', 'session_id', 'ip_address',
      'event_type', 'bytes_in', 'bytes_out', 'session_time', 'terminate_cause',
    ];
  }
  // Migration 457 adds a direct organization_id owner. Keep every generic
  // BaseModel read/update fail-closed even though the dedicated accounting
  // ingest path performs its own stricter tenant/NAS validation.
  static get hasOrgScope() { return true; }
}

module.exports = ConnectionLog;
