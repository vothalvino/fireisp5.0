// =============================================================================
// FireISP 5.0 — DeviceConfigBackup Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DeviceConfigBackup extends BaseModel {
  static get tableName() { return 'device_config_backups'; }

  static get fillable() {
    return [
      'device_id', 'version', 'config_type', 'content', 'file_size',
      'checksum', 'change_summary', 'capture_method', 'captured_by_user_id',
      'notes',
    ];
  }

  // device_config_backups has no organization_id column — it is tenant-scoped
  // through its parent device (fk_device_config_backups_device). Leaving org
  // scope on makes BaseModel emit WHERE organization_id = ? against a
  // non-existent column → 500 on every list/get.
  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = DeviceConfigBackup;
