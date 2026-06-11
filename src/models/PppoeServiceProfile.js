// =============================================================================
// FireISP 5.0 — PppoeServiceProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PppoeServiceProfile extends BaseModel {
  static get tableName() { return 'pppoe_service_profiles'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'service_name', 'mtu', 'mru', 'auth_methods',
      'dns_primary', 'dns_secondary', 'session_timeout_seconds', 'idle_timeout_seconds',
      'rate_limit_override', 'address_list', 'filter_id',
      'ipv6cp_enabled', 'delegated_prefix_len', 'dns_primary_v6', 'dns_secondary_v6', 'nat64_enabled', 'dns64_prefix',
      'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = PppoeServiceProfile;
