'use strict';

// =============================================================================
// FireISP 5.0 — IPv6 Transition Mechanism Validation Schemas
// =============================================================================

const createTransitionMechanism = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
  // 6rd fields
  border_relay_ip: { type: 'string', max: 45 },
  ipv6_prefix: { type: 'string', max: 50 },
  ipv4_mask_len: { type: 'number', min: 0, max: 32 },
  mtu: { type: 'number', min: 576, max: 9000 },
  // DS-Lite fields
  aftr_address: { type: 'string', max: 45 },
  b4_address_range: { type: 'string', max: 50 },
  // MAP-Rules fields
  rule_type: { type: 'string', enum: ['map-e', 'map-t'] },
  ipv4_prefix: { type: 'string', max: 50 },
  ea_bits_len: { type: 'number', min: 0, max: 48 },
  br_address: { type: 'string', max: 45 },
  // 464XLAT fields
  plat_prefix: { type: 'string', max: 50 },
  clat_prefix: { type: 'string', max: 50 },
  dns64_prefix: { type: 'string', max: 50 },
};

const updateTransitionMechanism = {
  name: { type: 'string', min: 1, max: 100 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
  // 6rd fields
  border_relay_ip: { type: 'string', max: 45 },
  ipv6_prefix: { type: 'string', max: 50 },
  ipv4_mask_len: { type: 'number', min: 0, max: 32 },
  mtu: { type: 'number', min: 576, max: 9000 },
  // DS-Lite fields
  aftr_address: { type: 'string', max: 45 },
  b4_address_range: { type: 'string', max: 50 },
  // MAP-Rules fields
  rule_type: { type: 'string', enum: ['map-e', 'map-t'] },
  ipv4_prefix: { type: 'string', max: 50 },
  ea_bits_len: { type: 'number', min: 0, max: 48 },
  br_address: { type: 'string', max: 45 },
  // 464XLAT fields
  plat_prefix: { type: 'string', max: 50 },
  clat_prefix: { type: 'string', max: 50 },
  dns64_prefix: { type: 'string', max: 50 },
};

module.exports = { createTransitionMechanism, updateTransitionMechanism };
