// =============================================================================
// FireISP 5.0 — Discovery Result Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DiscoveryResult extends BaseModel {
  static get tableName() { return 'discovery_results'; }

  static get fillable() {
    return [
      'scan_id', 'organization_id', 'ip_address', 'hostname', 'sys_descr', 'sys_oid',
      'snmp_version', 'manufacturer', 'model', 'device_type', 'suggested_profile_id',
      'status', 'device_id',
    ];
  }

  static get hasOrgScope() { return false; } // scoped via scan_id

  static get softDelete() { return false; }
}

module.exports = DiscoveryResult;
