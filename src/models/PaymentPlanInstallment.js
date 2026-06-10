// =============================================================================
// FireISP 5.0 — PaymentPlanInstallment Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PaymentPlanInstallment extends BaseModel {
  static get tableName() { return 'payment_plan_installments'; }

  static get fillable() {
    return [
      'organization_id', 'plan_id', 'invoice_id', 'sequence', 'amount',
      'due_date', 'status', 'paid_payment_id', 'paid_at',
    ];
  }

  // plan_id provides the scope; no separate org filter needed
  static get hasOrgScope() { return false; }

  static get softDelete() { return false; }
}

module.exports = PaymentPlanInstallment;
