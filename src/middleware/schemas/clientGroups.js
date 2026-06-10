// =============================================================================
// FireISP 5.0 — Client Group Validation Schemas
// =============================================================================

const createClientGroup = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  billing_mode: { type: 'string', enum: ['separate', 'shared'] },
  primary_client_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 65535 },
};

const updateClientGroup = {
  name: { type: 'string', min: 1, max: 255 },
  billing_mode: { type: 'string', enum: ['separate', 'shared'] },
  primary_client_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 65535 },
};

module.exports = { createClientGroup, updateClientGroup };
