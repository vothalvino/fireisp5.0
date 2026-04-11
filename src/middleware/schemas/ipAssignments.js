// =============================================================================
// FireISP 5.0 — IP Assignment Validation Schemas
// =============================================================================

const createIpAssignment = {
  pool_id: { type: 'number', required: true, min: 1 },
  contract_id: { type: 'number', min: 1 },
  device_id: { type: 'number', min: 1 },
  ip_address: { type: 'string', required: true, max: 45 },
  prefix_len: { type: 'number', min: 0, max: 128 },
  type: { type: 'string', enum: ['static', 'dynamic', 'reserved'] },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'available', 'expired'] },
};

const updateIpAssignment = {
  pool_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  device_id: { type: 'number', min: 1 },
  ip_address: { type: 'string', max: 45 },
  prefix_len: { type: 'number', min: 0, max: 128 },
  type: { type: 'string', enum: ['static', 'dynamic', 'reserved'] },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'available', 'expired'] },
};

module.exports = { createIpAssignment, updateIpAssignment };
