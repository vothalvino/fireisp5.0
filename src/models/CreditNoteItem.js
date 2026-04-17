// =============================================================================
// FireISP 5.0 — CreditNoteItem Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CreditNoteItem extends BaseModel {
  static get tableName() { return 'credit_note_items'; }

  static get fillable() {
    return [
      'credit_note_id', 'description', 'quantity', 'unit_price', 'amount',
    ];
  }

  static get hasOrgScope() { return false; }

  static get softDelete() { return true; }
}

module.exports = CreditNoteItem;
