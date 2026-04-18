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

  static async addItem(data) {
    const db = require('../config/database');
    const [result] = await db.query(
      `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, tax_rate_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.invoice_id, data.description, data.quantity, data.unit_price, data.amount, data.tax_rate_id || null],
    );
    const [rows] = await db.query('SELECT * FROM invoice_items WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = Invoice;
