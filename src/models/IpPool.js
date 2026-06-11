// =============================================================================
// FireISP 5.0 — IpPool Model
// =============================================================================

const BaseModel = require('./BaseModel');

class IpPool extends BaseModel {
  static get tableName() { return 'ip_pools'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'nas_id', 'name', 'network', 'subnet_mask',
      'gateway', 'ip_version', 'dns_primary', 'dns_secondary', 'service_type',
      'default_prefix_len', 'excluded_ranges', 'pool_type', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = IpPool;
