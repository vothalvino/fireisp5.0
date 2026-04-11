// =============================================================================
// FireISP 5.0 — Network Link Validation Schemas
// =============================================================================

const createNetworkLink = {
  device_a_id: { type: 'number', required: true, min: 1 },
  device_b_id: { type: 'number', required: true, min: 1 },
  link_type: { type: 'string', enum: ['fiber', 'wireless', 'copper', 'virtual', 'other'] },
  capacity_mbps: { type: 'number', min: 0 },
  interface_a: { type: 'string', max: 100 },
  interface_b: { type: 'string', max: 100 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'down', 'maintenance', 'decommissioned'] },
};

const updateNetworkLink = {
  device_a_id: { type: 'number', min: 1 },
  device_b_id: { type: 'number', min: 1 },
  link_type: { type: 'string', enum: ['fiber', 'wireless', 'copper', 'virtual', 'other'] },
  capacity_mbps: { type: 'number', min: 0 },
  interface_a: { type: 'string', max: 100 },
  interface_b: { type: 'string', max: 100 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'down', 'maintenance', 'decommissioned'] },
};

module.exports = { createNetworkLink, updateNetworkLink };
