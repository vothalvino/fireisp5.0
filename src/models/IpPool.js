// =============================================================================
// FireISP 5.0 — IpPool Model
// =============================================================================

const BaseModel = require('./BaseModel');

class IpPool extends BaseModel {
  static get tableName() { return 'ip_pools'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'name', 'network', 'subnet_mask',
      'gateway', 'ip_version', 'dns_primary', 'dns_secondary',
      'pool_type', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = IpPool;
