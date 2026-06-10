// =============================================================================
// FireISP 5.0 — Chargeback Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Chargeback extends BaseModel {
  static get tableName() { return 'chargebacks'; }

  static get fillable() {
    return [
      'organization_id', 'payment_id', 'gateway', 'gateway_dispute_id',
      'amount', 'currency', 'reason_code', 'status', 'due_by',
      'outcome_notes', 'linked_refund_request_id',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Chargeback;
