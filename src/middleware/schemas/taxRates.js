// =============================================================================
// FireISP 5.0 — Tax Rate Validation Schemas
// =============================================================================

const STATUSES = ['active', 'inactive'];

const createTaxRate = {
  name: { type: 'string', required: true, max: 100 },
  rate: { type: 'number', required: true, min: 0, max: 1 },
  description: { type: 'string', max: 5000 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: STATUSES },
};

const updateTaxRate = {
  name: { type: 'string', max: 100 },
  rate: { type: 'number', min: 0, max: 1 },
  description: { type: 'string', max: 5000 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: STATUSES },
};

module.exports = { createTaxRate, updateTaxRate };
