// =============================================================================
// FireISP 5.0 — RecurringPaymentProfile Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RecurringPaymentProfile extends BaseModel {
  static get tableName() { return 'recurring_payment_profiles'; }

  static get fillable() {
    return [
      // MUST be listed — see the note in DeviceConfigBackup.fillable.
      // crudController injects req.orgId only when hasOrgScope is true, and
      // BaseModel.create filters strictly to `fillable`, so leaving it out
      // writes a NULL-org row that nobody can see.
      'organization_id',
      'client_id', 'payment_gateway_id', 'token_reference',
      'card_brand', 'card_last_four', 'card_exp_month', 'card_exp_year',
      'is_default', 'status',
    ];
  }

  // Migration 425 added organization_id (denormalised from clients), so org
  // scoping is ON. The previous comment here justified disabling it as a
  // "single-tenant deployment" — which was never true of this product; it ships
  // reseller scoping. The effect was that SELECT * over this table returned
  // every org's token_reference and stripe_customer_id to anyone holding
  // recurring_payment_profiles.view, and update/delete were unscoped too.
  static get hasOrgScope() { return true; }

  // Table has a deleted_at column (added by migration 151) — soft-delete enabled.
  static get softDelete() { return true; }
}

module.exports = RecurringPaymentProfile;
