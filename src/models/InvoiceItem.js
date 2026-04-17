// =============================================================================
// FireISP 5.0 — InvoiceItem Model
// =============================================================================

const BaseModel = require('./BaseModel');

class InvoiceItem extends BaseModel {
  static get tableName() { return 'invoice_items'; }

  static get fillable() {
    return [
      'invoice_id', 'description', 'quantity', 'unit_price', 'amount',
      'tax_rate', 'tax_amount',
    ];
  }

  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = InvoiceItem;
