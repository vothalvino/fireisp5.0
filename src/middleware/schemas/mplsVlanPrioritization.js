'use strict';

// =============================================================================
// FireISP 5.0 — MPLS/VLAN Prioritization Rule Validation Schemas (§10.4)
// =============================================================================

const createMplsVlanRule = {
  name:                { type: 'string', required: true, min: 1, max: 100 },
  description:         { type: 'string', max: 1000 },
  rule_type:           { type: 'string', enum: ['vlan', 'mpls', 'qinq', 'mpls_vlan'] },
  vlan_id:             { type: 'number', min: 0, max: 4094 },
  inner_vlan_id:       { type: 'number', min: 0, max: 4094 },
  mpls_label:          { type: 'number', min: 0 },
  traffic_class:       { type: 'string', max: 50 },
  priority_bits:       { type: 'number', min: 0, max: 7 },
  dscp_value:          { type: 'number', min: 0, max: 63 },
  queue_class:         { type: 'string', max: 100 },
  enabled:             { type: 'number', min: 0, max: 1 },
};

const updateMplsVlanRule = {
  name:                { type: 'string', min: 1, max: 100 },
  description:         { type: 'string', max: 1000 },
  rule_type:           { type: 'string', enum: ['vlan', 'mpls', 'qinq', 'mpls_vlan'] },
  vlan_id:             { type: 'number', min: 0, max: 4094 },
  inner_vlan_id:       { type: 'number', min: 0, max: 4094 },
  mpls_label:          { type: 'number', min: 0 },
  traffic_class:       { type: 'string', max: 50 },
  priority_bits:       { type: 'number', min: 0, max: 7 },
  dscp_value:          { type: 'number', min: 0, max: 63 },
  queue_class:         { type: 'string', max: 100 },
  enabled:             { type: 'number', min: 0, max: 1 },
};

module.exports = { createMplsVlanRule, updateMplsVlanRule };
