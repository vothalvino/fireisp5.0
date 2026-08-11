// =============================================================================
// FireISP 5.0 — Contract Validation Schemas
// =============================================================================

const createContract = {
  client_id: { type: 'number', required: true, min: 1 },
  plan_id: { type: 'number', required: true, min: 1 },
  connection_type: { type: 'string', enum: ['pppoe', 'pppoe_dual', 'static', 'dual'] },
  start_date: { type: 'string', required: true },
  billing_day: { type: 'number', min: 1, max: 28 },
  price_override: { type: 'number', min: 0 },
  ip_address: { type: 'string', max: 45 },
  // Direct creation always begins pending/offline. Permanent activation is a
  // separate evidence-gated lifecycle action, never an insert-time choice.
  status: { type: 'string', enum: ['pending'] },
  facturar: { type: 'boolean' },
  escalation_enabled: { type: 'boolean' },
  escalate_on_disconnect: { type: 'boolean' },
  optical_min_dbm: { type: 'number', min: -100, max: 0 },
  wireless_signal_min_dbm: { type: 'number', min: -100, max: 0 },
  wireless_link_capacity_min_mbps: { type: 'number', min: 0.1, max: 10000 },
};

const updateContract = {
  client_id: { type: 'number', min: 1 },
  plan_id: { type: 'number', min: 1 },
  connection_type: { type: 'string', enum: ['pppoe', 'pppoe_dual', 'static', 'dual'] },
  start_date: { type: 'string' },
  end_date: { type: 'string' },
  billing_day: { type: 'number', min: 1, max: 28 },
  price_override: { type: 'number', min: 0 },
  ip_address: { type: 'string', max: 45 },
  status: { type: 'string', enum: ['pending', 'active', 'suspended', 'cancelled', 'terminated'] },
  facturar: { type: 'boolean' },
  escalation_enabled: { type: 'boolean' },
  escalate_on_disconnect: { type: 'boolean' },
  optical_min_dbm: { type: 'number', min: -100, max: 0 },
  wireless_signal_min_dbm: { type: 'number', min: -100, max: 0 },
  wireless_link_capacity_min_mbps: { type: 'number', min: 0.1, max: 10000 },
};

const createContractAddon = {
  plan_addon_id: { type: 'number', required: true, min: 1 },
  quantity: { type: 'number', min: 1 },
  unit_price: { type: 'number', min: 0 },
  start_date: { type: 'string' },
  end_date: { type: 'string' },
};

const prepareContractActivation = {
  assigned_to: { type: 'number', min: 1 },
};

const activateContract = {
  billing: { type: 'string', required: true, enum: ['already_paid', 'create_invoice'] },
  installation_fee: { type: 'number', min: 0.01 },
  description: { type: 'string', max: 255 },
};

const patchContract = Object.fromEntries(
  Object.entries(updateContract).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = {
  createContract, updateContract, patchContract, createContractAddon,
  prepareContractActivation, activateContract,
};
