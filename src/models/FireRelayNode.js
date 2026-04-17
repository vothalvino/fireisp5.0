// =============================================================================
// FireISP 5.0 — FireRelayNode Model
// =============================================================================

const BaseModel = require('./BaseModel');

class FireRelayNode extends BaseModel {
  static get tableName() {
    return 'firerelay_nodes';
  }

  static get fillable() {
    return [
      'id',
      'name',
      'api_url',
      'status',
      'client_count',
      'device_count',
      'cpu_percent',
      'memory_percent',
      'disk_percent',
      'db_size_mb',
      'uptime_seconds',
      'last_seen_at',
    ];
  }

  static get hasOrgScope() {
    return false;
  }

  static get softDelete() { return true; }
}

module.exports = FireRelayNode;
