// =============================================================================
// FireISP 5.0 — BillingAdjustment Model
// =============================================================================

const BaseModel = require('./BaseModel');

class BillingAdjustment extends BaseModel {
  static get tableName() { return 'billing_adjustments'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'entity_type', 'entity_id',
      'adjustment_type', 'amount_delta', 'reason', 'approved_by', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }

  // No soft delete on the adjustment log — it's an immutable audit trail
  static get softDelete() { return false; }
}

module.exports = BillingAdjustment;
