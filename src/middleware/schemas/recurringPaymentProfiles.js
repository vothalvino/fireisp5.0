// =============================================================================
// FireISP 5.0 — Recurring Payment Profile Validation Schemas
// =============================================================================

const createRecurringPaymentProfile = {
  client_id: { type: 'number', required: true, min: 1 },
  payment_gateway_id: { type: 'number', required: true, min: 1 },
  token_reference: { type: 'string', required: true, max: 500 },
  card_brand: { type: 'string', max: 20 },
  card_last_four: { type: 'string', max: 4 },
  card_exp_month: { type: 'number', min: 1, max: 12 },
  card_exp_year: { type: 'number', min: 2024, max: 2099 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

const updateRecurringPaymentProfile = {
  token_reference: { type: 'string', max: 500 },
  card_brand: { type: 'string', max: 20 },
  card_last_four: { type: 'string', max: 4 },
  card_exp_month: { type: 'number', min: 1, max: 12 },
  card_exp_year: { type: 'number', min: 2024, max: 2099 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

module.exports = { createRecurringPaymentProfile, updateRecurringPaymentProfile };
