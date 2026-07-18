// =============================================================================
// FireISP 5.0 — Client Group Validation Schemas
// =============================================================================

const createClientGroup = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  billing_mode: { type: 'string', enum: ['separate', 'shared'] },
  primary_client_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 65535 },
};

const updateClientGroup = {
  name: { type: 'string', min: 1, max: 255 },
  billing_mode: { type: 'string', enum: ['separate', 'shared'] },
  primary_client_id: { type: 'number', min: 1 },
  notes: { type: 'string', max: 65535 },
};

// Pay the group balance on behalf of members. All fields optional: amount
// omitted = pay the full payable total; invoice_ids restricts to a subset.
// The PAYMENT_METHODS enum mirrors payments — per-element checks on invoice_ids
// happen in the service (validate()'s 'array' only confirms the top-level shape).
const PAYMENT_METHODS = [
  'cash', 'check', 'card', 'transfer', 'online',
  'credit_card', 'debit_card', 'bank_transfer',
  'oxxo_pay', 'spei', 'codi', 'convenience_store',
  'digital_wallet', 'other',
];

const payClientGroup = {
  amount: { type: 'number', min: 0 },
  payment_method: { type: 'string', enum: PAYMENT_METHODS },
  reference_number: { type: 'string', max: 100 },
  invoice_ids: { type: 'array' },
};

module.exports = { createClientGroup, updateClientGroup, payClientGroup };
