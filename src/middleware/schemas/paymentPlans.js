// =============================================================================
// FireISP 5.0 — Payment Plan Validation Schemas
// =============================================================================

const createPaymentPlan = {
  client_id: { type: 'number', required: true, min: 1 },
  invoice_id: { type: 'number', min: 1 },
  total_amount: { type: 'number', required: true, min: 0.01 },
  installment_count: { type: 'number', required: true, min: 1, max: 60 },
  frequency: { type: 'string', required: true, enum: ['weekly', 'biweekly', 'monthly'] },
  notes: { type: 'string' },
};

const updatePaymentPlan = {
  notes: { type: 'string' },
  status: { type: 'string', enum: ['active', 'completed', 'defaulted', 'cancelled'] },
};

const payInstallmentSchema = {
  payment_id: { type: 'number', required: true, min: 1 },
};

module.exports = { createPaymentPlan, updatePaymentPlan, payInstallmentSchema };
