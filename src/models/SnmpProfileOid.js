// =============================================================================
// FireISP 5.0 — SnmpProfileOid Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SnmpProfileOid extends BaseModel {
  static get tableName() { return 'snmp_profile_oids'; }
  static get fillable() { return ['profile_id', 'oid', 'label', 'oid_type', 'metric_column', 'description', 'status']; }
  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = SnmpProfileOid;
