// =============================================================================
// FireISP 5.0 — CpeFirmwareCampaign Model (§8.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeFirmwareCampaign extends BaseModel {
  static get tableName() { return 'cpe_firmware_campaigns'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'firmware_version_id',
      'target_manufacturer', 'target_model', 'target_profile_id',
      'target_device_ids', 'status', 'scheduled_at', 'started_at',
      'completed_at', 'total_devices', 'completed_devices',
      'failed_devices', 'result_summary', 'created_by', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = CpeFirmwareCampaign;
