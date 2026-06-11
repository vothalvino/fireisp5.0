// =============================================================================
// FireISP 5.0 — OLT Port Validation Schemas (§7.1)
// =============================================================================

const createOltPort = {
  olt_device_id: { type: 'number', required: true, min: 1 },
  port_index: { type: 'number', required: true, min: 0 },
  port_name: { type: 'string', required: true, min: 1, max: 50 },
  port_type: { type: 'string', enum: ['gpon', 'epon', 'xgspon', 'uplink', 'cascade', 'other'] },
  slot_no: { type: 'number', min: 0, max: 255 },
  port_no: { type: 'number', min: 0, max: 255 },
  admin_status: { type: 'string', enum: ['up', 'down'] },
  max_onus: { type: 'number', min: 1, max: 256 },
  notes: { type: 'string', max: 1000 },
};

const updateOltPort = {
  port_name: { type: 'string', min: 1, max: 50 },
  port_type: { type: 'string', enum: ['gpon', 'epon', 'xgspon', 'uplink', 'cascade', 'other'] },
  slot_no: { type: 'number', min: 0, max: 255 },
  port_no: { type: 'number', min: 0, max: 255 },
  admin_status: { type: 'string', enum: ['up', 'down'] },
  max_onus: { type: 'number', min: 1, max: 256 },
  notes: { type: 'string', max: 1000 },
};

const patchOltPort = Object.fromEntries(
  Object.entries(updateOltPort).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOltPort, updateOltPort, patchOltPort };
