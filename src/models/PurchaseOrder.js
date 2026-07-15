// =============================================================================
// FireISP 5.0 — Purchase Order Model
// =============================================================================

const BaseModel = require('./BaseModel');
const db = require('../config/database');

class PurchaseOrder extends BaseModel {
  static get tableName() { return 'purchase_orders'; }

  static get fillable() {
    return [
      'organization_id', 'vendor_id', 'po_number', 'status',
      'order_date', 'expected_date', 'received_date', 'warehouse_id',
      'subtotal', 'tax_amount', 'total', 'currency', 'reference',
      'notes', 'created_by',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get line items for a purchase order.
   */
  static async getItems(poId) {
    const [rows] = await db.query(
      `SELECT poi.*, i.name AS item_name, i.sku, i.serial_required
       FROM purchase_order_items poi
       LEFT JOIN inventory_items i ON i.id = poi.inventory_item_id
       WHERE poi.po_id = ?
       ORDER BY poi.id`,
      [poId],
    );
    return rows;
  }
}

module.exports = PurchaseOrder;
