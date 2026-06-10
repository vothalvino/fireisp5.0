// =============================================================================
// FireISP 5.0 — Service Order Validation Schemas (§1.2)
// =============================================================================

const ORDER_TYPES = ['new_install', 'upgrade', 'downgrade', 'relocation', 'reconnect'];

const createServiceOrder = {
  client_id: { type: 'number', min: 1 },
  lead_id: { type: 'number', min: 1 },
  plan_id: { type: 'number', min: 1 },
  order_type: { type: 'string', enum: ORDER_TYPES },
  assigned_to: { type: 'number', min: 1 },
  address: { type: 'string', max: 500 },
  notes: { type: 'string', max: 65535 },
  order_number: { type: 'string', max: 40 },
};

const updateServiceOrder = {
  client_id: { type: 'number', min: 1 },
  lead_id: { type: 'number', min: 1 },
  plan_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  order_type: { type: 'string', enum: ORDER_TYPES },
  assigned_to: { type: 'number', min: 1 },
  address: { type: 'string', max: 500 },
  notes: { type: 'string', max: 65535 },
};

const patchServiceOrder = updateServiceOrder;

// Status transition request body (approve / start-provisioning / activate / cancel)
const activateServiceOrder = {
  contract_id: { type: 'number', min: 1 },
};

const createServiceOrderTask = {
  task_key: { type: 'string', required: true, min: 1, max: 60 },
  label: { type: 'string', required: true, min: 1, max: 200 },
  sort_order: { type: 'number', min: 0 },
  notes: { type: 'string', max: 65535 },
};

const updateServiceOrderTask = {
  label: { type: 'string', min: 1, max: 200 },
  is_done: { type: 'boolean' },
  sort_order: { type: 'number', min: 0 },
  notes: { type: 'string', max: 65535 },
};

module.exports = {
  createServiceOrder, updateServiceOrder, patchServiceOrder, activateServiceOrder,
  createServiceOrderTask, updateServiceOrderTask, ORDER_TYPES,
};
