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
    const [result] = await db.query(
      `INSERT INTO credit_note_items (credit_note_id, description, quantity, unit_price, amount, tax_rate_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.credit_note_id, data.description, data.quantity, data.unit_price, data.amount, data.tax_rate_id || null],
    );
    const [rows] = await db.query('SELECT * FROM credit_note_items WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = CreditNote;
