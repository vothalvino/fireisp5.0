// =============================================================================
// FireISP 5.0 — SNMP Trap Forwarding Rule Validation Schemas
// =============================================================================

const createTrapForwardingRule = {
  name: { type: 'string', min: 1, max: 200, required: true },
  match_trap_type: { type: 'string', max: 64, nullable: true },
  match_source_ip: { type: 'string', max: 15, nullable: true },
  match_oid_prefix: { type: 'string', max: 255, nullable: true },
  forward_to_url: { type: 'string', max: 500, nullable: true },
  // Kept as string here so blank input can be normalized to NULL by the
  // cross-field guard. That guard performs the same strict email validation
  // after merging partial updates with the existing rule.
  forward_to_email: { type: 'string', max: 255, nullable: true },
  forward_to_webhook_id: { type: 'number', min: 1, nullable: true },
  is_active: { type: 'boolean' },
};

const updateTrapForwardingRule = { ...createTrapForwardingRule };
delete updateTrapForwardingRule.name;
updateTrapForwardingRule.name = { type: 'string', min: 1, max: 200 };

module.exports = { createTrapForwardingRule, updateTrapForwardingRule };
