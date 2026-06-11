// =============================================================================
// FireISP 5.0 — Billing Dispute Validation Schemas
// =============================================================================

const DISPUTE_TYPES = ['billing_error', 'service_quality', 'unauthorized_charge', 'other'];
const DISPUTE_STATUSES = ['open', 'investigating', 'resolved_favor_client', 'resolved_favor_company', 'escalated'];

const createBillingDisputeSchema = {
  client_id:   { type: 'number', required: true },
  type:        { type: 'string', required: true, enum: DISPUTE_TYPES },
  description: { type: 'string', required: true, min: 1 },
  invoice_id:  { type: 'number' },
  payment_id:  { type: 'number' },
};

const updateBillingDisputeSchema = {
  type:             { type: 'string', enum: DISPUTE_TYPES },
  description:      { type: 'string', min: 1 },
  resolution_notes: { type: 'string' },
};

const transitionBillingDisputeSchema = {
  status:           { type: 'string', required: true, enum: DISPUTE_STATUSES },
  resolution_notes: { type: 'string' },
};

module.exports = {
  createBillingDisputeSchema,
  updateBillingDisputeSchema,
  transitionBillingDisputeSchema,
};
