// =============================================================================
// FireISP 5.0 — PaymentGateway Model
// =============================================================================

const BaseModel = require('./BaseModel');

class PaymentGateway extends BaseModel {
  static get tableName() { return 'payment_gateways'; }

  static get fillable() {
    return [
      'organization_id', 'provider', 'environment', 'public_key',
      'secret_key_encrypted', 'webhook_secret_encrypted', 'is_default',
      'config', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = PaymentGateway;
