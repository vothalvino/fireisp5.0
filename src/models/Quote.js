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

  static get softDelete() { return true; }

  static async getItems(quoteId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM quote_items WHERE quote_id = ? AND deleted_at IS NULL ORDER BY id',
      [quoteId],
    );
    return rows;
  }

  static async addItem(data) {
    const db = require('../config/database');
    // quote_items has NO writable `amount` column, and `total` is
    // `GENERATED ALWAYS AS (quantity * unit_price) STORED` (database/schema.sql)
    // — MySQL rejects any explicit value for a generated column
    // (ER_NON_DEFAULT_VALUE_FOR_GENERATED_COLUMN), so writing either one here
    // threw on every call. The API keeps accepting `amount` in the request body
    // for backward compatibility, but it is never persisted; `total` is always
    // computed by MySQL from quantity * unit_price and comes back on the SELECT
    // below.
    const [result] = await db.query(
      `INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate_id, inventory_item_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.quote_id, data.description, data.quantity, data.unit_price, data.tax_rate_id || null, data.inventory_item_id || null],
    );
    const [rows] = await db.query('SELECT * FROM quote_items WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = Quote;
