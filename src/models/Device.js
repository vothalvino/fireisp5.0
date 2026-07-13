// =============================================================================
// FireISP 5.0 — Device Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Device extends BaseModel {
  static get tableName() { return 'devices'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'client_id', 'contract_id', 'name', 'type',
      'manufacturer', 'model', 'serial_number', 'mac_address',
      'ip_address', 'ipv6_address', 'snmp_enabled', 'snmp_community',
      'snmp_version', 'snmp_port', 'snmp_profile_id',
      'firmware', 'status', 'notes', 'role',
      'snmp_v3_security_name', 'snmp_v3_auth_protocol', 'snmp_v3_auth_key_encrypted',
      'snmp_v3_priv_protocol', 'snmp_v3_priv_key_encrypted', 'snmp_v3_context_name',
      'last_polled_at', 'last_poll_error',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Device;
