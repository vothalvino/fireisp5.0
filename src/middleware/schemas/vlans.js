// =============================================================================
// FireISP 5.0 — VLAN Validation Schemas
// =============================================================================

const createVlan = {
  vlan_id: { type: 'number', required: true, min: 1, max: 4094 },
  name: { type: 'string', required: true, min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  site_id: { type: 'number', min: 1 },
  status: { type: 'string', enum: ['active', 'reserved', 'deprecated'] },
};

const updateVlan = {
  vlan_id: { type: 'number', min: 1, max: 4094 },
  name: { type: 'string', min: 1, max: 255 },
  description: { type: 'string', max: 5000 },
  site_id: { type: 'number', min: 1 },
  status: { type: 'string', enum: ['active', 'reserved', 'deprecated'] },
};

module.exports = { createVlan, updateVlan };
