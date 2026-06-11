// =============================================================================
// FireISP 5.0 — CpeDevice Model (§8.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeDevice extends BaseModel {
  static get tableName() { return 'cpe_devices'; }

  static get fillable() {
    return [
      'organization_id', 'serial_number', 'oui', 'product_class',
      'hardware_version', 'software_version', 'firmware_version',
      'manufacturer', 'model_name', 'acs_username', 'acs_password_hash',
      'device_id', 'contract_id', 'cpe_profile_id', 'status',
      'last_inform_at', 'last_inform_ip', 'wan_ip', 'lan_subnet',
      'wifi_ssid', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = CpeDevice;
