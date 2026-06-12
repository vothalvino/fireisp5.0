// =============================================================================
// FireISP 5.0 — Asset Validation Schemas
// =============================================================================

const createAsset = {
  asset_tag: { type: 'string', required: false, max: 100 },
  barcode: { type: 'string', required: false, max: 200 },
  name: { type: 'string', required: true, max: 255 },
  category: { type: 'string', required: false, enum: ['router', 'switch', 'onu', 'olt', 'sfp', 'cable', 'antenna', 'cpe', 'server', 'tool', 'other'] },
  manufacturer: { type: 'string', required: false, max: 100 },
  model: { type: 'string', required: false, max: 100 },
  serial_number: { type: 'string', required: false, max: 100 },
  inventory_item_id: { type: 'number', required: false },
  warehouse_id: { type: 'number', required: false },
  vendor_id: { type: 'number', required: false },
  purchase_order_id: { type: 'number', required: false },
  lifecycle_status: { type: 'string', required: false, enum: ['in_stock', 'assigned', 'deployed', 'maintenance', 'rma', 'disposed'] },
  purchase_date: { type: 'string', required: false },
  purchase_cost: { type: 'number', required: false, min: 0 },
  warranty_expires_at: { type: 'string', required: false },
  warranty_notes: { type: 'string', required: false },
  depreciation_method: { type: 'string', required: false, enum: ['straight_line', 'declining_balance', 'none'] },
  useful_life_months: { type: 'number', required: false, min: 1 },
  salvage_value: { type: 'number', required: false, min: 0 },
  notes: { type: 'string', required: false },
};

const updateAsset = {
  asset_tag: { type: 'string', required: false, max: 100 },
  barcode: { type: 'string', required: false, max: 200 },
  name: { type: 'string', required: false, max: 255 },
  category: { type: 'string', required: false, enum: ['router', 'switch', 'onu', 'olt', 'sfp', 'cable', 'antenna', 'cpe', 'server', 'tool', 'other'] },
  manufacturer: { type: 'string', required: false, max: 100 },
  model: { type: 'string', required: false, max: 100 },
  serial_number: { type: 'string', required: false, max: 100 },
  inventory_item_id: { type: 'number', required: false },
  warehouse_id: { type: 'number', required: false },
  vendor_id: { type: 'number', required: false },
  purchase_order_id: { type: 'number', required: false },
  lifecycle_status: { type: 'string', required: false, enum: ['in_stock', 'assigned', 'deployed', 'maintenance', 'rma', 'disposed'] },
  purchase_date: { type: 'string', required: false },
  purchase_cost: { type: 'number', required: false, min: 0 },
  warranty_expires_at: { type: 'string', required: false },
  warranty_notes: { type: 'string', required: false },
  depreciation_method: { type: 'string', required: false, enum: ['straight_line', 'declining_balance', 'none'] },
  useful_life_months: { type: 'number', required: false, min: 1 },
  salvage_value: { type: 'number', required: false, min: 0 },
  notes: { type: 'string', required: false },
};

const assignAsset = {
  client_id: { type: 'number', required: false },
  device_id: { type: 'number', required: false },
  port_name: { type: 'string', required: false, max: 100 },
  notes: { type: 'string', required: false },
};

const disposeAsset = {
  disposal_reason: { type: 'string', required: true, enum: ['end_of_life', 'damaged', 'lost', 'stolen', 'sold', 'other'] },
  disposal_notes: { type: 'string', required: false },
};

const scanAsset = {
  barcode: { type: 'string', required: true, max: 200 },
};

module.exports = { createAsset, updateAsset, assignAsset, disposeAsset, scanAsset };
