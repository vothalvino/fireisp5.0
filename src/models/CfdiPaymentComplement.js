// =============================================================================
// FireISP 5.0 — CfdiPaymentComplement Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CfdiPaymentComplement extends BaseModel {
  static get tableName() { return 'cfdi_payment_complements'; }
  static get fillable() { return ['cfdi_document_id', 'payment_id', 'fecha_pago', 'forma_pago_p', 'moneda_p', 'tipo_cambio_p', 'monto']; }
  static get hasOrgScope() { return false; }
}

module.exports = CfdiPaymentComplement;
