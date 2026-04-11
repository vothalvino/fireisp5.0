// =============================================================================
// FireISP 5.0 — FacturaPublicaInvoiceItem Model
// =============================================================================

const BaseModel = require('./BaseModel');

class FacturaPublicaInvoiceItem extends BaseModel {
  static get tableName() { return 'factura_publica_invoice_items'; }
  static get fillable() { return ['factura_publica_invoice_id', 'invoice_id']; }
  static get hasOrgScope() { return false; }
}

module.exports = FacturaPublicaInvoiceItem;
