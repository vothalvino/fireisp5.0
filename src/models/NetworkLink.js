// =============================================================================
// FireISP 5.0 — NetworkLink Model
// =============================================================================

const BaseModel = require('./BaseModel');

class NetworkLink extends BaseModel {
  static get tableName() { return 'network_links'; }

  static get fillable() {
    return [
      'organization_id', 'device_a_id', 'device_b_id', 'link_type',
      'capacity_mbps', 'interface_a', 'interface_b', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = NetworkLink;
