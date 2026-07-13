// =============================================================================
// FireISP 5.0 — Credit Note Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CreditNote extends BaseModel {
  static get tableName() { return 'credit_notes'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'invoice_id', 'payment_id',
      'credit_note_number', 'reason', 'subtotal', 'tax_amount',
      'total', 'currency', 'tax_rate', 'tax_rate_id', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static async getItems(creditNoteId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM credit_note_items WHERE credit_note_id = ? AND deleted_at IS NULL ORDER BY id',
      [creditNoteId],
    );
    return rows;
  }

  static async addItem(data) {
    const db = require('../config/database');
    // credit_note_items has NO writable `amount` column, and `total` is
    // `GENERATED ALWAYS AS (quantity * unit_price) STORED` (database/schema.sql)
    // — MySQL rejects any explicit value for a generated column
    // (ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN), so writing either one here
    // threw on every call. The API keeps accepting `amount` in the request body
    // for backward compatibility, but it is never persisted; `total` is always
    // computed by MySQL from quantity * unit_price and comes back on the SELECT
    // below.
    const [result] = await db.query(
      `INSERT INTO credit_note_items (credit_note_id, description, quantity, unit_price, tax_rate_id)
       VALUES (?, ?, ?, ?, ?)`,
      [data.credit_note_id, data.description, data.quantity, data.unit_price, data.tax_rate_id || null],
    );
    const [rows] = await db.query('SELECT * FROM credit_note_items WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = CreditNote;
