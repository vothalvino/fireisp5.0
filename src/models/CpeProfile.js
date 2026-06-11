// =============================================================================
// FireISP 5.0 — CpeProfile Model (§8.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeProfile extends BaseModel {
  static get tableName() { return 'cpe_profiles'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'description', 'parent_profile_id',
      'plan_id', 'manufacturer', 'model_name', 'wifi_ssid_template',
      'wifi_security', 'wifi_channel', 'wifi_band', 'wan_mode',
      'wan_vlan_id', 'parameters', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
}

module.exports = CpeProfile;
