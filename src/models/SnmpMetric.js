// =============================================================================
// FireISP 5.0 — SnmpMetric Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SnmpMetric extends BaseModel {
  static get tableName() { return 'snmp_metrics'; }
  static get fillable() { return ['device_id', 'profile_oid_id', 'value_gauge', 'value_counter', 'value_string', 'polled_at']; }
  static get hasOrgScope() { return false; }
}

module.exports = SnmpMetric;
