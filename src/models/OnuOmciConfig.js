// =============================================================================
// FireISP 5.0 — OnuOmciConfig Model (§7.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class OnuOmciConfig extends BaseModel {
  static get tableName() { return 'onu_omci_configs'; }

  static get fillable() {
    return [
      'organization_id', 'device_id', 'config_type',
      'wifi_ssid', 'wifi_password_encrypted', 'wifi_band',
      'wifi_channel', 'wifi_security',
      'wan_mode', 'wan_ip_mode', 'wan_ip_address', 'wan_netmask', 'wan_gateway',
      'delivery_method', 'applied_at', 'apply_status', 'apply_error',
      'raw_config', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static get sortable() {
    return ['id', 'config_type', 'apply_status', 'applied_at', 'created_at'];
  }
}

module.exports = OnuOmciConfig;
