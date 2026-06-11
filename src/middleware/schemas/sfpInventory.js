// =============================================================================
// FireISP 5.0 — SFP Inventory Validation Schemas (§7.4)
// =============================================================================

const FORM_FACTORS = ['sfp', 'sfp_plus', 'sfp28', 'qsfp', 'qsfp_plus', 'xfp', 'gbic', 'other'];
const FIBER_TYPES = ['sm', 'mm', 'copper'];
const LIFECYCLE_STATUSES = ['in_stock', 'installed', 'removed', 'failed', 'retired'];

const createSfpInventory = {
  serial_number: { type: 'string', max: 64 },
  vendor_name: { type: 'string', max: 64 },
  part_number: { type: 'string', max: 64 },
  form_factor: { type: 'string', enum: FORM_FACTORS },
  fiber_type: { type: 'string', enum: FIBER_TYPES },
  wavelength_nm: { type: 'number', min: 800, max: 2000 },
  max_distance_m: { type: 'number', min: 0 },
  speed_gbps: { type: 'number', min: 0 },
  lifecycle_status: { type: 'string', enum: LIFECYCLE_STATUSES },
  installed_device_id: { type: 'number', min: 1 },
  port_name: { type: 'string', max: 50 },
  installed_at: { type: 'string', max: 10 },
  removed_at: { type: 'string', max: 10 },
  failure_reason: { type: 'string', max: 2000 },
  inventory_item_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 2000 },
};

const updateSfpInventory = {
  serial_number: { type: 'string', max: 64 },
  vendor_name: { type: 'string', max: 64 },
  part_number: { type: 'string', max: 64 },
  form_factor: { type: 'string', enum: FORM_FACTORS },
  fiber_type: { type: 'string', enum: FIBER_TYPES },
  wavelength_nm: { type: 'number', min: 800, max: 2000 },
  max_distance_m: { type: 'number', min: 0 },
  speed_gbps: { type: 'number', min: 0 },
  lifecycle_status: { type: 'string', enum: LIFECYCLE_STATUSES },
  installed_device_id: { type: 'number', min: 1 },
  port_name: { type: 'string', max: 50 },
  installed_at: { type: 'string', max: 10 },
  removed_at: { type: 'string', max: 10 },
  failure_reason: { type: 'string', max: 2000 },
  inventory_item_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 2000 },
};

const patchSfpInventory = Object.fromEntries(
  Object.entries(updateSfpInventory).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createSfpInventory, updateSfpInventory, patchSfpInventory };
