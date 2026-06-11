// =============================================================================
// FireISP 5.0 — Device Polling Config Model (§6.4)
// =============================================================================

const BaseModel = require('./BaseModel');

class DevicePollingConfig extends BaseModel {
  static get tableName() { return 'device_polling_configs'; }

  static get fillable() {
    return [
      'organization_id',
      'device_id',
      'device_type',
      'poller_node_id',
      'poll_interval_sec',
      'bulk_get_enabled',
      'max_repetitions',
      'timeout_ms',
      'retries',
      'failover_node_id',
      'adaptive_polling_enabled',
      'adaptive_min_interval_sec',
      'is_enabled',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = DevicePollingConfig;
