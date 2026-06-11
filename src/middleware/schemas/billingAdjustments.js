// =============================================================================
// FireISP 5.0 — Billing Adjustment Validation Schemas
// =============================================================================

const ENTITY_TYPES = ['invoice', 'payment', 'credit_note', 'balance'];
const ADJUSTMENT_TYPES = ['late_fee_waiver', 'discount', 'correction', 'write_off', 'other'];

const createBillingAdjustmentSchema = {
  client_id:       { type: 'number', required: true },
  entity_type:     { type: 'string', required: true, enum: ENTITY_TYPES },
  entity_id:       { type: 'number', required: true },
  adjustment_type: { type: 'string', required: true, enum: ADJUSTMENT_TYPES },
  amount_delta:    { type: 'number', required: true },
  reason:          { type: 'string', required: true, min: 1 },
  approved_by:     { type: 'number' },
};

module.exports = { createBillingAdjustmentSchema };
