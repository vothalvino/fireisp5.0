// =============================================================================
// FireISP 5.0 — InventoryTransaction Model
// =============================================================================

const BaseModel = require('./BaseModel');

class InventoryTransaction extends BaseModel {
  static get tableName() { return 'inventory_transactions'; }
  static get fillable() { return ['organization_id', 'item_id', 'warehouse_id', 'transaction_type', 'quantity', 'unit_cost', 'reference', 'notes', 'created_by']; }
  static get hasOrgScope() { return true; }
}

module.exports = InventoryTransaction;
