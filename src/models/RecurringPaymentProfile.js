// =============================================================================
// FireISP 5.0 — RecurringPaymentProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RecurringPaymentProfile extends BaseModel {
  static get tableName() { return 'recurring_payment_profiles'; }

  static get fillable() {
    return [
      'client_id', 'payment_gateway_id', 'token_reference',
      'card_brand', 'card_last_four', 'card_exp_month', 'card_exp_year',
      'is_default', 'status',
    ];
  }

  // Table recurring_payment_profiles has no organization_id column
  // (single-tenant deployment) — org scoping disabled to avoid a
  // WHERE organization_id = ? against a non-existent column.
  static get hasOrgScope() { return false; }

  // Table has a deleted_at column (added by migration 151) — soft-delete enabled.
  static get softDelete() { return true; }
}

module.exports = RecurringPaymentProfile;
