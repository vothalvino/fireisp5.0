// =============================================================================
// FireISP 5.0 — IpPool Model
// =============================================================================

const BaseModel = require('./BaseModel');

class IpPool extends BaseModel {
  static get tableName() { return 'ip_pools'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'nas_id', 'service_profile_id', 'name', 'network', 'subnet_mask',
      'gateway', 'ip_version', 'dns_primary', 'dns_secondary', 'service_type',
      'default_prefix_len', 'excluded_ranges', 'pool_type', 'status', 'notes',
      'dhcpv6_mode', 'ra_enabled', 'ra_managed_flag', 'ra_other_flag', 'ra_lifetime_seconds', 'slaac_prefix', 'region_name',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = IpPool;
