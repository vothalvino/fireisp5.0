// =============================================================================
// FireISP 5.0 — Quote Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Quote extends BaseModel {
  static get tableName() { return 'quotes'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'contract_id', 'quote_number',
      'subtotal', 'tax_amount', 'total', 'currency', 'tax_rate',
      'tax_rate_id', 'valid_until', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static async getItems(quoteId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id',
      [quoteId],
    );
    return rows;
  }

  static async addItem(data) {
    const db = require('../config/database');
    const [result] = await db.query(
      `INSERT INTO quote_items (quote_id, description, quantity, unit_price, amount, tax_rate_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.quote_id, data.description, data.quantity, data.unit_price, data.amount, data.tax_rate_id || null],
    );
    const [rows] = await db.query('SELECT * FROM quote_items WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = Quote;
