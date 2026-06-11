// =============================================================================
// FireISP 5.0 — SNMP Trap Forwarding Rule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class TrapForwardingRule extends BaseModel {
  static get tableName() { return 'snmp_trap_forwarding_rules'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'match_trap_type', 'match_source_ip', 'match_oid_prefix',
      'forward_to_url', 'forward_to_email', 'forward_to_webhook_id',
      'transform_template', 'is_active',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = TrapForwardingRule;
