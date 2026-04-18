// =============================================================================
// FireISP 5.0 — QuoteItem Model
// =============================================================================

const BaseModel = require('./BaseModel');

class QuoteItem extends BaseModel {
  static get tableName() { return 'quote_items'; }

  static get fillable() {
    return [
      'quote_id', 'description', 'quantity', 'unit_price', 'amount',
      'tax_rate', 'tax_amount',
    ];
  }

  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = QuoteItem;
