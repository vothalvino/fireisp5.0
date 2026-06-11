// =============================================================================
// FireISP 5.0 — OnuProfile Model (§7.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class OnuProfile extends BaseModel {
  static get tableName() { return 'onu_profiles'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'technology', 'tcont_id',
      'dba_profile_name', 'assured_bw_kbps', 'max_bw_kbps',
      'gem_port_id', 'service_vlan', 'client_vlan', 'vlan_mode',
      'plan_id', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static get sortable() {
    return ['id', 'name', 'technology', 'created_at'];
  }
}

module.exports = OnuProfile;
