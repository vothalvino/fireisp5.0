// =============================================================================
// FireISP 5.0 — RMA Request Validation Schemas
// =============================================================================

const createRmaRequest = {
  rma_number: { type: 'string', required: true, max: 100 },
  asset_id: { type: 'number', required: false },
  vendor_id: { type: 'number', required: false },
  reason: { type: 'string', required: false, enum: ['defective', 'wrong_item', 'damaged_in_transit', 'warranty_claim', 'other'] },
  description: { type: 'string', required: false },
  notes: { type: 'string', required: false },
};

const updateRmaRequest = {
  rma_number: { type: 'string', required: false, max: 100 },
  asset_id: { type: 'number', required: false },
  vendor_id: { type: 'number', required: false },
  reason: { type: 'string', required: false, enum: ['defective', 'wrong_item', 'damaged_in_transit', 'warranty_claim', 'other'] },
  description: { type: 'string', required: false },
  notes: { type: 'string', required: false },
  replacement_asset_id: { type: 'number', required: false },
};

const shipRma = {
  notes: { type: 'string', required: false },
};

const receiveRma = {
  notes: { type: 'string', required: false },
};

const closeRma = {
  status: { type: 'string', required: true, enum: ['closed', 'denied'] },
  replacement_asset_id: { type: 'number', required: false },
  notes: { type: 'string', required: false },
};

module.exports = { createRmaRequest, updateRmaRequest, shipRma, receiveRma, closeRma };
