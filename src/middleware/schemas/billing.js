// =============================================================================
// FireISP 5.0 — Billing Validation Schemas
// =============================================================================

const generatePeriod = {
  contract_id: { type: 'number', required: true, min: 1 },
};

const generateInvoice = {
  contract_id: { type: 'number', required: true, min: 1 },
};

const allocatePayment = {
  payment_id: { type: 'number', required: true, min: 1 },
  allocations: { type: 'array', required: true },
};

module.exports = { generatePeriod, generateInvoice, allocatePayment };
