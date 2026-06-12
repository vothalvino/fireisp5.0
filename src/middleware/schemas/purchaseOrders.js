// =============================================================================
// FireISP 5.0 — Purchase Order Validation Schemas
// =============================================================================

const createPurchaseOrder = {
  vendor_id: { type: 'number', required: false },
  po_number: { type: 'string', required: true, max: 100 },
  status: { type: 'string', required: false, enum: ['draft', 'sent', 'partial', 'received', 'cancelled'] },
  order_date: { type: 'string', required: false },
  expected_date: { type: 'string', required: false },
  received_date: { type: 'string', required: false },
  warehouse_id: { type: 'number', required: false },
  subtotal: { type: 'number', required: false, min: 0 },
  tax_amount: { type: 'number', required: false, min: 0 },
  total: { type: 'number', required: false, min: 0 },
  currency: { type: 'string', required: false, max: 3 },
  reference: { type: 'string', required: false, max: 255 },
  notes: { type: 'string', required: false },
};

const updatePurchaseOrder = {
  vendor_id: { type: 'number', required: false },
  po_number: { type: 'string', required: false, max: 100 },
  status: { type: 'string', required: false, enum: ['draft', 'sent', 'partial', 'received', 'cancelled'] },
  order_date: { type: 'string', required: false },
  expected_date: { type: 'string', required: false },
  received_date: { type: 'string', required: false },
  warehouse_id: { type: 'number', required: false },
  subtotal: { type: 'number', required: false, min: 0 },
  tax_amount: { type: 'number', required: false, min: 0 },
  total: { type: 'number', required: false, min: 0 },
  currency: { type: 'string', required: false, max: 3 },
  reference: { type: 'string', required: false, max: 255 },
  notes: { type: 'string', required: false },
};

const createPoItem = {
  inventory_item_id: { type: 'number', required: false },
  description: { type: 'string', required: true, max: 255 },
  quantity_ordered: { type: 'number', required: true, min: 1 },
  quantity_received: { type: 'number', required: false, min: 0 },
  unit_cost: { type: 'number', required: false, min: 0 },
  notes: { type: 'string', required: false },
};

const updatePoItem = {
  inventory_item_id: { type: 'number', required: false },
  description: { type: 'string', required: false, max: 255 },
  quantity_ordered: { type: 'number', required: false, min: 1 },
  quantity_received: { type: 'number', required: false, min: 0 },
  unit_cost: { type: 'number', required: false, min: 0 },
  notes: { type: 'string', required: false },
};

const receivePo = {
  received_date: { type: 'string', required: false },
  notes: { type: 'string', required: false },
};

module.exports = { createPurchaseOrder, updatePurchaseOrder, createPoItem, updatePoItem, receivePo };
