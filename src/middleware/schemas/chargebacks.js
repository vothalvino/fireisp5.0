// =============================================================================
// FireISP 5.0 — Chargeback Validation Schemas
// =============================================================================

const CHARGEBACK_STATUSES = ['received', 'evidence_submitted', 'won', 'lost', 'accepted'];

const createChargebackSchema = {
  amount:             { type: 'number', required: true, min: 0.01 },
  currency:           { type: 'string', required: true, min: 3, max: 3 },
  payment_id:         { type: 'number' },
  gateway:            { type: 'string' },
  gateway_dispute_id: { type: 'string' },
  reason_code:        { type: 'string' },
  status:             { type: 'string', enum: CHARGEBACK_STATUSES },
  due_by:             { type: 'string' },
};

const updateChargebackSchema = {
  status:                   { type: 'string', enum: CHARGEBACK_STATUSES },
  outcome_notes:            { type: 'string' },
  due_by:                   { type: 'string' },
  linked_refund_request_id: { type: 'number' },
};

module.exports = { createChargebackSchema, updateChargebackSchema };
