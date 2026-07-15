// =============================================================================
// FireISP 5.0 — Invoice Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Invoice extends BaseModel {
  static get tableName() { return 'invoices'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'contract_id', 'invoice_number',
      'subtotal', 'tax_amount', 'total', 'currency', 'tax_rate',
      'tax_rate_id', 'due_date', 'paid_at', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static async getItems(invoiceId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM invoice_items WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id',
      [invoiceId],
    );
    return rows;
  }

  /**
   * @param {object} data
   * @param {(sql: string, params: unknown[]) => Promise<[unknown, unknown]>} [exec]
   *   Optional bound query function (e.g. `conn.execute.bind(conn)`) so the
   *   caller can run this on a transaction connection — used by
   *   POST /invoices/:id/items when the line is inventory-linked and must be
   *   atomic with a stock drawdown. Defaults to the pool.
   */
  static async addItem(data, exec = null) {
    const db = require('../config/database');
    const run = exec || db.query.bind(db);
    const [result] = await run(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, tax_rate_id, inventory_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [data.invoice_id, data.description, data.quantity, data.unit_price, data.amount, data.tax_rate_id || null, data.inventory_item_id || null],
    );
    const [rows] = await run('SELECT * FROM invoice_items WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = Invoice;
