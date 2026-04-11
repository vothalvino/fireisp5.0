// =============================================================================
// FireISP 5.0 — PaymentAllocation Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PaymentAllocation extends BaseModel {
  static get tableName() { return 'payment_allocations'; }

  static get fillable() {
    return [
      'payment_id', 'invoice_id', 'amount',
    ];
  }

  static get hasOrgScope() { return false; }
}

module.exports = PaymentAllocation;
