// =============================================================================
// FireISP 5.0 — Bulk Operations Validation Schemas
// =============================================================================

// POST /bulk/invoices/generate — contract_ids validated manually in route
const generateInvoices = {
  // No additional non-array fields to validate (contract_ids is an array)
};

// POST /bulk/invoices/void — invoice_ids validated manually in route
const voidInvoices = {
  // No additional non-array fields to validate (invoice_ids is an array)
};

// POST /bulk/suspend — contract_ids validated manually in route
const suspend = {
  reason: { type: 'string', max: 500 },
};

// POST /bulk/email — client_ids validated manually in route
const email = {
  subject: { type: 'string', required: true, min: 1, max: 500 },
  body: { type: 'string', required: true, min: 1, max: 50000 },
};

module.exports = { generateInvoices, voidInvoices, suspend, email };
