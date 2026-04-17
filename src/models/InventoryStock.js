// =============================================================================
// FireISP 5.0 — InventoryStock Model
// =============================================================================

const BaseModel = require('./BaseModel');

class InventoryStock extends BaseModel {
  static get tableName() { return 'inventory_stock'; }
  static get fillable() { return ['organization_id', 'item_id', 'warehouse_id', 'quantity_on_hand', 'quantity_reserved']; }
  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = InventoryStock;
