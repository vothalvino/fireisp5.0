// =============================================================================
// FireISP 5.0 — RecurringPaymentProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RecurringPaymentProfile extends BaseModel {
  static get tableName() { return 'recurring_payment_profiles'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'payment_gateway_id',
      'gateway_customer_id', 'gateway_card_token', 'card_brand',
      'card_last_four', 'card_expiry_month', 'card_expiry_year',
      'is_default', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = RecurringPaymentProfile;
