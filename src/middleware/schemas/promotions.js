// =============================================================================
// FireISP 5.0 — Promotion Validation Schemas
// =============================================================================

const DISCOUNT_TYPES = ['percentage', 'fixed_amount'];
const PROMOTION_TYPES = ['coupon', 'promotional', 'referral'];
const APPLIES_TO = ['contract', 'invoice', 'plan'];

const createPromotion = {
  name: { type: 'string', required: true, max: 150 },
  code: { type: 'string', max: 50 },
  description: { type: 'string', max: 5000 },
  discount_type: { type: 'string', required: true, enum: DISCOUNT_TYPES },
  discount_value: { type: 'number', required: true, min: 0 },
  promotion_type: { type: 'string', enum: PROMOTION_TYPES },
  applies_to: { type: 'string', enum: APPLIES_TO },
  max_uses: { type: 'number', min: 0 },
  max_uses_per_client: { type: 'number', min: 0 },
  min_order_value: { type: 'number', min: 0 },
  duration_months: { type: 'number', min: 0, max: 255 },
  starts_at: { type: 'string' },
  ends_at: { type: 'string' },
  is_active: { type: 'boolean' },
};

const updatePromotion = {
  name: { type: 'string', max: 150 },
  code: { type: 'string', max: 50 },
  description: { type: 'string', max: 5000 },
  discount_type: { type: 'string', enum: DISCOUNT_TYPES },
  discount_value: { type: 'number', min: 0 },
  promotion_type: { type: 'string', enum: PROMOTION_TYPES },
  applies_to: { type: 'string', enum: APPLIES_TO },
  max_uses: { type: 'number', min: 0 },
  max_uses_per_client: { type: 'number', min: 0 },
  min_order_value: { type: 'number', min: 0 },
  duration_months: { type: 'number', min: 0, max: 255 },
  starts_at: { type: 'string' },
  ends_at: { type: 'string' },
  is_active: { type: 'boolean' },
};

module.exports = { createPromotion, updatePromotion };
