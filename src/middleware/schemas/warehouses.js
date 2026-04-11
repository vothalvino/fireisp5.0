// =============================================================================
// FireISP 5.0 — Warehouse Validation Schemas
// =============================================================================

const createWarehouse = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  address: { type: 'string', max: 255 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 100 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateWarehouse = {
  name: { type: 'string', min: 1, max: 255 },
  address: { type: 'string', max: 255 },
  city: { type: 'string', max: 100 },
  state: { type: 'string', max: 100 },
  zip_code: { type: 'string', max: 20 },
  country: { type: 'string', max: 100 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createWarehouse, updateWarehouse };
