// =============================================================================
// FireISP 5.0 — PaymentTransaction Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PaymentTransaction extends BaseModel {
  static get tableName() { return 'payment_transactions'; }

  static get fillable() {
    return [
      'organization_id', 'payment_id', 'payment_gateway_id',
      'provider_reference', 'gateway_status', 'amount', 'currency',
      'idempotency_key', 'request_payload', 'response_payload',
      'webhook_payload',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = PaymentTransaction;
