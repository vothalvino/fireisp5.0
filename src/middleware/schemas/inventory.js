// =============================================================================
// FireISP 5.0 — Inventory Validation Schemas
// =============================================================================

const createInventoryItem = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  sku: { type: 'string', max: 100 },
  category: { type: 'string', enum: ['antenna', 'cable', 'router', 'switch', 'onu', 'olt', 'cpe', 'connector', 'power_supply', 'enclosure', 'tool', 'other'] },
  manufacturer: { type: 'string', max: 100 },
  model: { type: 'string', max: 100 },
  description: { type: 'string', max: 5000 },
  unit: { type: 'string', max: 30 },
  unit_cost: { type: 'number', min: 0 },
  sale_price: { type: 'number', min: 0 },
  reorder_level: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'discontinued'] },
};

const updateInventoryItem = {
  name: { type: 'string', min: 1, max: 255 },
  sku: { type: 'string', max: 100 },
  category: { type: 'string', enum: ['antenna', 'cable', 'router', 'switch', 'onu', 'olt', 'cpe', 'connector', 'power_supply', 'enclosure', 'tool', 'other'] },
  manufacturer: { type: 'string', max: 100 },
  model: { type: 'string', max: 100 },
  description: { type: 'string', max: 5000 },
  unit: { type: 'string', max: 30 },
  unit_cost: { type: 'number', min: 0 },
  sale_price: { type: 'number', min: 0 },
  reorder_level: { type: 'number', min: 0 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'discontinued'] },
};

const createInventoryTransaction = {
  stock_id: { type: 'number', required: true, min: 1 },
  transaction_type: { type: 'string', required: true, enum: ['receive', 'assign_to_job', 'sell_to_client', 'transfer_out', 'transfer_in', 'return', 'adjustment'] },
  quantity: { type: 'number', required: true },
  unit_price: { type: 'number', min: 0 },
  job_id: { type: 'number', min: 1 },
  client_id: { type: 'number', min: 1 },
  invoice_id: { type: 'number', min: 1 },
  reference: { type: 'string', max: 255 },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createInventoryItem, updateInventoryItem, createInventoryTransaction };
