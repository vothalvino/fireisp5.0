// =============================================================================
// FireISP 5.0 — PaymentPlan Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PaymentPlan extends BaseModel {
  static get tableName() { return 'payment_plans'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'total_amount', 'installment_count',
      'frequency', 'status', 'notes', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = PaymentPlan;
