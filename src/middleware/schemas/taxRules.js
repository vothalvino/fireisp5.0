// =============================================================================
// FireISP 5.0 — Tax Rule Validation Schemas
// =============================================================================

const TAX_TYPES = ['vat', 'sales_tax', 'gst', 'other'];
const STATUSES = ['active', 'inactive'];

const createTaxRule = {
  name: { type: 'string', required: true, max: 255 },
  region: { type: 'string', max: 100 },
  tax_type: { type: 'string', enum: TAX_TYPES },
  rate: { type: 'number', required: true, min: 0, max: 1 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: STATUSES },
};

const updateTaxRule = {
  name: { type: 'string', max: 255 },
  region: { type: 'string', max: 100 },
  tax_type: { type: 'string', enum: TAX_TYPES },
  rate: { type: 'number', min: 0, max: 1 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: STATUSES },
};

module.exports = { createTaxRule, updateTaxRule };
