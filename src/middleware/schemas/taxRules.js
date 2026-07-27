// =============================================================================
// FireISP 5.0 — Tax Rule Validation Schemas
// =============================================================================

const TAX_TYPES = ['vat', 'sales_tax', 'gst', 'other'];
const STATUSES = ['active', 'inactive'];

// A comma-separated list of 5-digit codes and/or 5-digit ranges:
//   "21000-22999,32000-32699,88000"
// Enforced here because a malformed entry silently matches nothing, which bills
// a border subscriber at 16% with no error anywhere.
const POSTAL_CODES = /^\s*\d{5}(\s*-\s*\d{5})?(\s*,\s*\d{5}(\s*-\s*\d{5})?)*\s*$/;

const createTaxRule = {
  name: { type: 'string', required: true, max: 255 },
  region: { type: 'string', max: 100 },
  postal_codes: { type: 'string', max: 2000, pattern: POSTAL_CODES },
  tax_type: { type: 'string', enum: TAX_TYPES },
  rate: { type: 'number', required: true, min: 0, max: 1 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: STATUSES },
};

const updateTaxRule = {
  name: { type: 'string', max: 255 },
  region: { type: 'string', max: 100 },
  postal_codes: { type: 'string', max: 2000, pattern: POSTAL_CODES },
  tax_type: { type: 'string', enum: TAX_TYPES },
  rate: { type: 'number', min: 0, max: 1 },
  is_default: { type: 'boolean' },
  status: { type: 'string', enum: STATUSES },
};

module.exports = { createTaxRule, updateTaxRule };
