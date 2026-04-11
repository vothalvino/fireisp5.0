// =============================================================================
// FireISP 5.0 — BillingPeriod Model
// =============================================================================

const BaseModel = require('./BaseModel');

class BillingPeriod extends BaseModel {
  static get tableName() { return 'billing_periods'; }

  static get fillable() {
    return [
      'organization_id', 'contract_id', 'period_start', 'period_end',
      'invoice_id', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = BillingPeriod;
