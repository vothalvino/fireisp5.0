// =============================================================================
// FireISP 5.0 — OLT Splitter Validation Schemas (§7.1)
// =============================================================================

const createOltSplitter = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  site_id: { type: 'number', min: 1 },
  olt_port_id: { type: 'number', min: 1 },
  ratio: { type: 'string', enum: ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64', '1:128'] },
  splitter_type: { type: 'string', enum: ['optical', 'wdm', 'other'] },
  location_detail: { type: 'string', max: 255 },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: ['active', 'inactive', 'damaged', 'removed'] },
  notes: { type: 'string', max: 1000 },
};

const updateOltSplitter = {
  name: { type: 'string', min: 1, max: 100 },
  site_id: { type: 'number', min: 1 },
  olt_port_id: { type: 'number', min: 1 },
  ratio: { type: 'string', enum: ['1:2', '1:4', '1:8', '1:16', '1:32', '1:64', '1:128'] },
  splitter_type: { type: 'string', enum: ['optical', 'wdm', 'other'] },
  location_detail: { type: 'string', max: 255 },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: ['active', 'inactive', 'damaged', 'removed'] },
  notes: { type: 'string', max: 1000 },
};

const patchOltSplitter = Object.fromEntries(
  Object.entries(updateOltSplitter).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createOltSplitter, updateOltSplitter, patchOltSplitter };
