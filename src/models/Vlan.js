// =============================================================================
// FireISP 5.0 — Vlan Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Vlan extends BaseModel {
  static get tableName() { return 'vlans'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'vlan_id', 'name', 'description',
      'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = Vlan;
