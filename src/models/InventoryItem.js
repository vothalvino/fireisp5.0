// =============================================================================
// FireISP 5.0 — Inventory Item Model
// =============================================================================

const BaseModel = require('./BaseModel');

class InventoryItem extends BaseModel {
  static get tableName() { return 'inventory_items'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'sku', 'category', 'manufacturer', 'model',
      'description', 'unit', 'unit_cost', 'sale_price', 'reorder_level', 'notes', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  /**
   * Get stock levels for this item across all warehouses.
   */
  static async getStock(itemId) {
    const db = require('../config/database');
    const [rows] = await db.query(`
      SELECT s.*, w.name AS warehouse_name
      FROM inventory_stock s
      JOIN warehouses w ON w.id = s.warehouse_id
      WHERE s.item_id = ?
      ORDER BY w.name
    `, [itemId]);
    return rows;
  }
}

module.exports = InventoryItem;
