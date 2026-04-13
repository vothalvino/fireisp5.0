// =============================================================================
// FireISP 5.0 — Payment Transaction Validation Schemas
// =============================================================================
// Payment transactions are primarily read-only in the API (created by the
// payment gateway service), but query-parameter validation is still useful
// for the OpenAPI spec and for safeguarding the listing endpoint.
// =============================================================================

const listPaymentTransactions = {
  gateway_status: { type: 'string', enum: ['pending', 'succeeded', 'failed', 'refunded'] },
  currency: { type: 'string', max: 3 },
  page: { type: 'number', min: 1 },
  limit: { type: 'number', min: 1, max: 100 },
};

module.exports = { listPaymentTransactions };
