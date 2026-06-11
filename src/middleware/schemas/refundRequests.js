// =============================================================================
// FireISP 5.0 — Refund Request Validation Schemas
// =============================================================================

const REFUND_REASONS = ['overcharge', 'duplicate', 'cancellation', 'service_issue', 'other'];
const REFUND_METHODS = ['original_method', 'credit_balance', 'manual'];

const createRefundRequestSchema = {
  client_id:  { type: 'number', required: true },
  amount:     { type: 'number', required: true, min: 0.01 },
  reason:     { type: 'string', required: true, enum: REFUND_REASONS },
  payment_id: { type: 'number' },
  invoice_id: { type: 'number' },
};

const updateRefundRequestSchema = {
  amount:     { type: 'number', min: 0.01 },
  reason:     { type: 'string', enum: REFUND_REASONS },
  payment_id: { type: 'number' },
  invoice_id: { type: 'number' },
};

const reviewRefundRequestSchema = {
  status:       { type: 'string', required: true, enum: ['approved', 'rejected'] },
  review_notes: { type: 'string' },
};

const processRefundRequestSchema = {
  refund_method:             { type: 'string', required: true, enum: REFUND_METHODS },
  gateway_refund_reference:  { type: 'string' },
};

module.exports = {
  createRefundRequestSchema,
  updateRefundRequestSchema,
  reviewRefundRequestSchema,
  processRefundRequestSchema,
};
