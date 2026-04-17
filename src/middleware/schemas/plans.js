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
  priority: { type: 'number', min: 1, max: 8 },
  status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
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
  priority: { type: 'number', min: 1, max: 8 },
  status: { type: 'string', enum: ['active', 'inactive', 'archived'] },
};

const createPlanAddon = {
  name: { type: 'string', required: true, min: 1, max: 200 },
  addon_type: { type: 'string', required: true, enum: ['static_ip', 'extra_ip_block', 'extra_bandwidth', 'equipment_rental', 'other'] },
  price: { type: 'number', required: true, min: 0 },
  billing_cycle: { type: 'string', enum: ['monthly', 'one_time', 'yearly'] },
  taxable: { type: 'boolean' },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const patchPlan = Object.fromEntries(
  Object.entries(updatePlan).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createPlan, updatePlan, patchPlan, createPlanAddon };
