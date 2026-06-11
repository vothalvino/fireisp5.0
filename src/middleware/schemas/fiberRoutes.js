// =============================================================================
// FireISP 5.0 — Fiber Route Validation Schemas (§7.4)
// =============================================================================

const ROUTE_TYPES = ['trunk', 'distribution', 'drop', 'feeder', 'other'];
const ROUTE_STATUSES = ['active', 'inactive', 'damaged', 'removed'];

const createFiberRoute = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  route_type: { type: 'string', enum: ROUTE_TYPES },
  parent_route_id: { type: 'number', min: 1 },
  from_device_id: { type: 'number', min: 1 },
  from_olt_port_id: { type: 'number', min: 1 },
  from_splitter_id: { type: 'number', min: 1 },
  to_device_id: { type: 'number', min: 1 },
  to_splitter_id: { type: 'number', min: 1 },
  to_onu_detail_id: { type: 'number', min: 1 },
  cable_length_m: { type: 'number', min: 0 },
  cable_type: { type: 'string', max: 50 },
  attenuation_db: { type: 'number', min: 0 },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: ROUTE_STATUSES },
  notes: { type: 'string', max: 2000 },
};

const updateFiberRoute = {
  name: { type: 'string', min: 1, max: 100 },
  route_type: { type: 'string', enum: ROUTE_TYPES },
  parent_route_id: { type: 'number', min: 1 },
  from_device_id: { type: 'number', min: 1 },
  from_olt_port_id: { type: 'number', min: 1 },
  from_splitter_id: { type: 'number', min: 1 },
  to_device_id: { type: 'number', min: 1 },
  to_splitter_id: { type: 'number', min: 1 },
  to_onu_detail_id: { type: 'number', min: 1 },
  cable_length_m: { type: 'number', min: 0 },
  cable_type: { type: 'string', max: 50 },
  attenuation_db: { type: 'number', min: 0 },
  installed_at: { type: 'string', max: 10 },
  status: { type: 'string', enum: ROUTE_STATUSES },
  notes: { type: 'string', max: 2000 },
};

const patchFiberRoute = Object.fromEntries(
  Object.entries(updateFiberRoute).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createFiberRoute, updateFiberRoute, patchFiberRoute };
