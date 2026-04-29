// =============================================================================
// FireISP 5.0 — Device Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Device extends BaseModel {
  static get tableName() { return 'devices'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'contract_id', 'name', 'type',
      'manufacturer', 'model', 'serial_number', 'mac_address',
      'ip_address', 'ipv6_address', 'snmp_enabled', 'snmp_community',
      'snmp_version', 'snmp_port', 'snmp_profile_id',
      'firmware_version', 'status', 'notes', 'role',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Device;
