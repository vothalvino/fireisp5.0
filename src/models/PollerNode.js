// =============================================================================
// FireISP 5.0 — Poller Node Model (§6.4)
// =============================================================================

const BaseModel = require('./BaseModel');

class PollerNode extends BaseModel {
  static get tableName() { return 'poller_nodes'; }

  static get fillable() {
    return [
      'node_identifier',
      'name',
      'status',
      'api_url',
      'max_concurrent_polls',
      'current_queue_depth',
      'total_polls_today',
      'failed_polls_today',
      'avg_poll_duration_ms',
      'last_heartbeat_at',
    ];
  }

  static get hasOrgScope() { return false; }

  static get softDelete() { return false; }
}

module.exports = PollerNode;
