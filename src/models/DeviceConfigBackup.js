// =============================================================================
// FireISP 5.0 — DeviceConfigBackup Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DeviceConfigBackup extends BaseModel {
  static get tableName() { return 'device_config_backups'; }

  static get fillable() {
    return [
      'organization_id', 'device_id', 'config_data',
      'checksum_sha256', 'version_label', 'capture_method', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = DeviceConfigBackup;
