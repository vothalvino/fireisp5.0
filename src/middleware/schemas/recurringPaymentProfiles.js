// =============================================================================
// FireISP 5.0 — Recurring Payment Profile Validation Schemas
// =============================================================================

const createRecurringPaymentProfile = {
  client_id: { type: 'number', required: true, min: 1 },
  gateway_id: { type: 'number', required: true, min: 1 },
  gateway_customer_id: { type: 'string', max: 255 },
  gateway_card_token: { type: 'string', max: 500 },
  card_brand: { type: 'string', max: 50 },
  card_last_four: { type: 'string', max: 4 },
  card_exp_month: { type: 'number', min: 1, max: 12 },
  card_exp_year: { type: 'number', min: 2024, max: 2099 },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

const updateRecurringPaymentProfile = {
  gateway_customer_id: { type: 'string', max: 255 },
  gateway_card_token: { type: 'string', max: 500 },
  card_brand: { type: 'string', max: 50 },
  card_last_four: { type: 'string', max: 4 },
  card_exp_month: { type: 'number', min: 1, max: 12 },
  card_exp_year: { type: 'number', min: 2024, max: 2099 },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

module.exports = { createRecurringPaymentProfile, updateRecurringPaymentProfile };
