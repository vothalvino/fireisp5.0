// =============================================================================
// FireISP 5.0 — Plan Validation Schemas
// =============================================================================

const createPlan = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  download_speed_mbps: { type: 'number', required: true, min: 0 },
  upload_speed_mbps: { type: 'number', required: true, min: 0 },
  price: { type: 'number', required: true, min: 0 },
  currency: { type: 'string', max: 3 },
  billing_cycle: { type: 'string', enum: ['monthly', 'quarterly', 'semi_annual', 'annual'] },
  data_cap_gb: { type: 'number', min: 0 },
  burst_download_mbps: { type: 'number', min: 0 },
  burst_upload_mbps: { type: 'number', min: 0 },
  burst_threshold_mbps: { type: 'number', min: 0 },
  burst_time_seconds: { type: 'number', min: 1, max: 255 },
  priority: { type: 'number', min: 1, max: 8 },
  priority_class_id: { type: 'number', min: 1 },
  status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
  stack_type: { type: 'string', enum: ['ipv4_only', 'ipv6_only', 'dual_stack'] },
};

const updatePlan = {
  name: { type: 'string', min: 1, max: 200 },
  description: { type: 'string', max: 1000 },
  download_speed_mbps: { type: 'number', min: 0 },
  upload_speed_mbps: { type: 'number', min: 0 },
  price: { type: 'number', min: 0 },
  currency: { type: 'string', max: 3 },
  billing_cycle: { type: 'string', enum: ['monthly', 'quarterly', 'semi_annual', 'annual'] },
  data_cap_gb: { type: 'number', min: 0 },
  burst_download_mbps: { type: 'number', min: 0 },
  burst_upload_mbps: { type: 'number', min: 0 },
  burst_threshold_mbps: { type: 'number', min: 0 },
  burst_time_seconds: { type: 'number', min: 1, max: 255 },
  priority: { type: 'number', min: 1, max: 8 },
  priority_class_id: { type: 'number', min: 1 },
  status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
  stack_type: { type: 'string', enum: ['ipv4_only', 'ipv6_only', 'dual_stack'] },
};

const createPlanAddon = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  addon_type: { type: 'string', required: true, enum: ['static_ip', 'extra_ip_block', 'extra_bandwidth', 'equipment_rental', 'voip', 'iptv', 'other'] },
  // Optional link to a physical inventory_items row this catalog product is
  // backed by (migration 390) — org-ownership is verified in the route
  // handler (422 on cross-org/nonexistent), not here.
  inventory_item_id: { type: 'number', min: 1 },
  price: { type: 'number', required: true, min: 0 },
  billing_cycle: { type: 'string', enum: ['monthly', 'one_time', 'yearly'] },
  taxable: { type: 'boolean' },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const patchPlan = Object.fromEntries(
  Object.entries(updatePlan).map(([k, v]) => [k, { ...v, required: false }]),
);

const createSpeedWindow = {
  label: { type: 'string', required: true, min: 1, max: 100 },
  day_mask: { type: 'number', min: 1, max: 127 },
  start_time: { type: 'string', required: true },
  end_time: { type: 'string', required: true },
  download_speed_mbps: { type: 'number', required: true, min: 0 },
  upload_speed_mbps: { type: 'number', required: true, min: 0 },
  priority: { type: 'number', min: 1, max: 255 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const createAccessWindow = {
  label: { type: 'string', required: true, min: 1, max: 100 },
  day_mask: { type: 'number', min: 1, max: 127 },
  start_time: { type: 'string', required: true },
  end_time: { type: 'string', required: true },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createPlan, updatePlan, patchPlan, createPlanAddon, createSpeedWindow, createAccessWindow };
