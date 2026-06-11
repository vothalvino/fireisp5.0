// =============================================================================
// FireISP 5.0 — CpeFirmwareVersion Model (§8.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeFirmwareVersion extends BaseModel {
  static get tableName() { return 'cpe_firmware_versions'; }

  static get fillable() {
    return [
      'organization_id', 'manufacturer', 'model_name', 'version',
      'firmware_url', 'file_size_bytes', 'checksum', 'checksum_type',
      'is_stable', 'release_notes',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = CpeFirmwareVersion;
