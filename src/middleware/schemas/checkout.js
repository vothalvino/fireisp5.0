// =============================================================================
// FireISP 5.0 — Checkout Validation Schemas
// =============================================================================

const createSession = {
  invoice_id: { type: 'number', required: true },
  client_id: { type: 'number', required: false },
  return_url: { type: 'string', required: false },
};

const createPaymentLink = {
  invoice_id: { type: 'number', required: true },
};

module.exports = { createSession, createPaymentLink };
