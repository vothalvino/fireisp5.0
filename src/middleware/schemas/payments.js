// =============================================================================
// FireISP 5.0 — Payment Validation Schemas
// =============================================================================

const createPayment = {
  client_id: { type: 'number', required: true, min: 1 },
  amount: { type: 'number', required: true, min: 0 },
  currency: { type: 'string', max: 3 },
  payment_method: { type: 'string', enum: ['cash', 'card', 'transfer', 'check', 'online', 'other'] },
  reference: { type: 'string', max: 200 },
  sat_forma_pago: { type: 'string', max: 2 },
  clabe: { type: 'string', max: 18 },
  bank_name: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'] },
};

const updatePayment = {
  amount: { type: 'number', min: 0 },
  currency: { type: 'string', max: 3 },
  payment_method: { type: 'string', enum: ['cash', 'card', 'transfer', 'check', 'online', 'other'] },
  reference: { type: 'string', max: 200 },
  status: { type: 'string', enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'] },
};

const allocatePayment = {
  invoice_id: { type: 'number', required: true, min: 1 },
  amount: { type: 'number', required: true, min: 0 },
};

const patchPayment = Object.fromEntries(
  Object.entries(updatePayment).map(([k, v]) => [k, { ...v, required: false }]),
);

module.exports = { createPayment, updatePayment, patchPayment, allocatePayment };
