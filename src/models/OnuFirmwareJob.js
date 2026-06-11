// =============================================================================
// FireISP 5.0 — OnuFirmwareJob Model (§7.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class OnuFirmwareJob extends BaseModel {
  static get tableName() { return 'onu_firmware_jobs'; }

  static get fillable() {
    return [
      'organization_id', 'job_type', 'scope',
      'onu_device_id', 'olt_device_id', 'olt_port_id',
      'firmware_version', 'firmware_url',
      'scheduled_at', 'started_at', 'completed_at',
      'status', 'total_devices', 'completed_devices', 'failed_devices',
      'result_summary', 'error_message', 'created_by', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static get sortable() {
    return ['id', 'status', 'job_type', 'scheduled_at', 'created_at'];
  }
}

module.exports = OnuFirmwareJob;
