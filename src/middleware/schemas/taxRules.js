// =============================================================================
// FireISP 5.0 — Tax Rule Validation Schemas
// =============================================================================

const TAX_TYPES = ['vat', 'sales_tax', 'gst', 'other'];
const STATUSES = ['active', 'inactive'];

// A comma-separated list of postal codes, ranges and/or prefixes:
//   "21000-22999,32000-32699,88000"   Mexico / US / Spain — 5-digit
//   "0801-0899,0301"                  Panama — 4-digit
//   "K1A*,M5V*"                       Canada — alphanumeric prefix
//   "3000-3999"                       Australia — 4-digit
//
// Deliberately NOT 5-digit-only. The first version of this pattern was, which
// meant an operator outside a 5-digit country could not save a rule for their
// own addresses at all — a Mexican assumption baked into a feature that is
// supposed to be region-agnostic.
//
// Enforced here because a malformed entry silently matches nothing, which bills
// the subscriber at the default rate with no error anywhere.
const ENTRY = '[A-Za-z0-9]{1,10}\\*?(\\s*-\\s*[A-Za-z0-9]{1,10})?';
const POSTAL_CODES = new RegExp(`^\\s*${ENTRY}(\\s*,\\s*${ENTRY})*\\s*$`);

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
