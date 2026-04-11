// =============================================================================
// FireISP 5.0 — Inventory Validation Schemas
// =============================================================================

const createInventoryItem = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  sku: { type: 'string', max: 100 },
  category: { type: 'string', enum: ['router', 'olt', 'onu', 'switch', 'cable', 'connector', 'sfp', 'power_supply', 'enclosure', 'tool', 'other'] },
  description: { type: 'string', max: 5000 },
  unit_price: { type: 'number', min: 0 },
  reorder_level: { type: 'number', min: 0 },
  status: { type: 'string', enum: ['active', 'discontinued'] },
};

const updateInventoryItem = {
  name: { type: 'string', min: 1, max: 255 },
  sku: { type: 'string', max: 100 },
  category: { type: 'string', enum: ['router', 'olt', 'onu', 'switch', 'cable', 'connector', 'sfp', 'power_supply', 'enclosure', 'tool', 'other'] },
  description: { type: 'string', max: 5000 },
  unit_price: { type: 'number', min: 0 },
  reorder_level: { type: 'number', min: 0 },
  status: { type: 'string', enum: ['active', 'discontinued'] },
};

const createInventoryTransaction = {
  item_id: { type: 'number', required: true, min: 1 },
  warehouse_id: { type: 'number', required: true, min: 1 },
  transaction_type: { type: 'string', required: true, enum: ['purchase', 'sale', 'transfer_in', 'transfer_out', 'adjustment', 'rma_return', 'rma_send', 'write_off'] },
  quantity: { type: 'number', required: true },
  unit_cost: { type: 'number', min: 0 },
  reference: { type: 'string', max: 255 },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createInventoryItem, updateInventoryItem, createInventoryTransaction };
