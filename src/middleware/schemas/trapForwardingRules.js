// =============================================================================
// FireISP 5.0 — SNMP Trap Forwarding Rule Validation Schemas
// =============================================================================

const createTrapForwardingRule = {
  name: { type: 'string', minLength: 1, maxLength: 200, required: true },
  match_trap_type: { type: 'string', maxLength: 64 },
  match_source_ip: { type: 'string', maxLength: 45 },
  match_oid_prefix: { type: 'string', maxLength: 255 },
  forward_to_url: { type: 'string', maxLength: 500 },
  forward_to_email: { type: 'string', maxLength: 255 },
  forward_to_webhook_id: { type: 'number', minimum: 1 },
  transform_template: { type: 'string', maxLength: 10000 },
  is_active: { type: 'boolean' },
};

const updateTrapForwardingRule = { ...createTrapForwardingRule };
delete updateTrapForwardingRule.name;
updateTrapForwardingRule.name = { type: 'string', minLength: 1, maxLength: 200 };

module.exports = { createTrapForwardingRule, updateTrapForwardingRule };
