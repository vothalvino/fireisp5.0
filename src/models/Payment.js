// =============================================================================
// FireISP 5.0 — Payment Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Payment extends BaseModel {
  static get tableName() { return 'payments'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'amount', 'currency',
      'payment_method', 'reference', 'sat_forma_pago',
      'clabe', 'bank_name', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get payment allocations for this payment.
   */
  static async getAllocations(paymentId) {
    const db = require('../config/database');
    const [rows] = await db.query(
      'SELECT * FROM payment_allocations WHERE payment_id = ? AND deleted_at IS NULL',
      [paymentId],
    );
    return rows;
  }

  /**
   * Allocate a payment amount to an invoice.
   * The DB trigger prevents over-allocation.
   */
  static async allocate(paymentId, invoiceId, amount) {
    const db = require('../config/database');
    const [result] = await db.query(
      'INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?, ?, ?)',
      [paymentId, invoiceId, amount],
    );
    const [rows] = await db.query('SELECT * FROM payment_allocations WHERE id = ?', [result.insertId]);
    return rows[0];
  }
}

module.exports = Payment;
