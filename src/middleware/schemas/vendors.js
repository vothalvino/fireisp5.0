// =============================================================================
// FireISP 5.0 — Vendor Validation Schemas
// =============================================================================

const createVendor = {
  name: { type: 'string', required: true, max: 255 },
  contact_name: { type: 'string', required: false, max: 100 },
  email: { type: 'string', required: false, max: 255 },
  phone: { type: 'string', required: false, max: 50 },
  website: { type: 'string', required: false, max: 255 },
  address: { type: 'string', required: false },
  tax_id: { type: 'string', required: false, max: 100 },
  payment_terms: { type: 'string', required: false, max: 100 },
  currency: { type: 'string', required: false, max: 3 },
  notes: { type: 'string', required: false },
  status: { type: 'string', required: false, enum: ['active', 'inactive'] },
};

const updateVendor = {
  name: { type: 'string', required: false, max: 255 },
  contact_name: { type: 'string', required: false, max: 100 },
  email: { type: 'string', required: false, max: 255 },
  phone: { type: 'string', required: false, max: 50 },
  website: { type: 'string', required: false, max: 255 },
  address: { type: 'string', required: false },
  tax_id: { type: 'string', required: false, max: 100 },
  payment_terms: { type: 'string', required: false, max: 100 },
  currency: { type: 'string', required: false, max: 3 },
  notes: { type: 'string', required: false },
  status: { type: 'string', required: false, enum: ['active', 'inactive'] },
};

module.exports = { createVendor, updateVendor };
