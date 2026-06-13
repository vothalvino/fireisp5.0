// =============================================================================
// FireISP 5.0 — RouterDriverConfig Model (§18.3)
// =============================================================================

const BaseModel = require('./BaseModel');

class RouterDriverConfig extends BaseModel {
  static get tableName() { return 'router_driver_configs'; }

  static get fillable() {
    return [
      'organization_id', 'device_id', 'vendor', 'protocol',
      'host', 'port', 'username', 'encrypted_password', 'api_token',
      'ssl_enabled', 'ssl_verify', 'timeout_ms', 'extra_params',
      'is_active', 'last_tested_at', 'last_test_status', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = RouterDriverConfig;
