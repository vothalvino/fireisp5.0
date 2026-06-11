// =============================================================================
// FireISP 5.0 — ODF Frame/Port/Cross-Connect Validation Schemas (§7.4)
// =============================================================================

const FRAME_TYPES = ['rack', 'wall_mount', 'splice_closure', 'patch_panel', 'other'];
const FIBER_TYPES = ['sm', 'mm', 'om3', 'om4', 'other'];
const CONNECTOR_TYPES = ['sc', 'lc', 'fc', 'st', 'mtp', 'other'];
const FRAME_STATUSES = ['active', 'inactive', 'decommissioned'];
const PORT_STATUSES = ['empty', 'connected', 'dirty', 'damaged', 'reserved'];

// ODF Frames
const createOdfFrame = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  site_id: { type: 'number', min: 1 },
  frame_type: { type: 'string', enum: FRAME_TYPES },
  port_count: { type: 'number', min: 1, max: 10000 },
  fiber_type: { type: 'string', enum: FIBER_TYPES },
  connector_type: { type: 'string', enum: CONNECTOR_TYPES },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: FRAME_STATUSES },
  location_detail: { type: 'string', max: 255 },
  notes: { type: 'string', max: 2000 },
};

const updateOdfFrame = {
  name: { type: 'string', min: 1, max: 100 },
  site_id: { type: 'number', min: 1 },
  frame_type: { type: 'string', enum: FRAME_TYPES },
  port_count: { type: 'number', min: 1, max: 10000 },
  fiber_type: { type: 'string', enum: FIBER_TYPES },
  connector_type: { type: 'string', enum: CONNECTOR_TYPES },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: FRAME_STATUSES },
  location_detail: { type: 'string', max: 255 },
  notes: { type: 'string', max: 2000 },
};

const patchOdfFrame = Object.fromEntries(
  Object.entries(updateOdfFrame).map(([k, v]) => [k, { ...v, required: false }]),
);

// ODF Ports
const createOdfPort = {
  odf_frame_id: { type: 'number', required: true, min: 1 },
  port_number: { type: 'number', required: true, min: 1 },
  port_label: { type: 'string', max: 50 },
  port_status: { type: 'string', enum: PORT_STATUSES },
  connected_device_id: { type: 'number', min: 1 },
  cable_label: { type: 'string', max: 100 },
  splitter_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 2000 },
};

const updateOdfPort = {
  port_label: { type: 'string', max: 50 },
  port_status: { type: 'string', enum: PORT_STATUSES },
  connected_device_id: { type: 'number', min: 1 },
  cable_label: { type: 'string', max: 100 },
  splitter_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 2000 },
};

const patchOdfPort = Object.fromEntries(
  Object.entries(updateOdfPort).map(([k, v]) => [k, { ...v, required: false }]),
);

// ODF Cross-Connects
const createOdfCrossConnect = {
  port_a_id: { type: 'number', required: true, min: 1 },
  port_b_id: { type: 'number', required: true, min: 1 },
  patch_cord_label: { type: 'string', max: 100 },
  patch_cord_length_m: { type: 'number', min: 0 },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: ['active', 'inactive', 'removed'] },
  notes: { type: 'string', max: 2000 },
};

const updateOdfCrossConnect = {
  patch_cord_label: { type: 'string', max: 100 },
  patch_cord_length_m: { type: 'number', min: 0 },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: ['active', 'inactive', 'removed'] },
  notes: { type: 'string', max: 2000 },
};

const patchOdfCrossConnect = Object.fromEntries(
  Object.entries(updateOdfCrossConnect).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = {
  createOdfFrame, updateOdfFrame, patchOdfFrame,
  createOdfPort, updateOdfPort, patchOdfPort,
  createOdfCrossConnect, updateOdfCrossConnect, patchOdfCrossConnect,
};
