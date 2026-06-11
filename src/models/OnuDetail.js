// =============================================================================
// FireISP 5.0 — OnuDetail Model (§7.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class OnuDetail extends BaseModel {
  static get tableName() { return 'onu_details'; }

  static get fillable() {
    return [
      'organization_id', 'device_id', 'olt_device_id', 'olt_port_id',
      'onu_profile_id', 'serial_number', 'loid', 'loid_password_encrypted',
      'onu_state', 'last_status_at', 'onu_id', 'ranging_distance_m',
      'line_profile_name', 'service_profile_name', 'wan_mode',
      'last_provision_job_id', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static get sortable() {
    return ['id', 'onu_state', 'serial_number', 'last_status_at', 'created_at'];
  }
}

module.exports = OnuDetail;
