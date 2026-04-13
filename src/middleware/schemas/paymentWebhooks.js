// =============================================================================
// FireISP 5.0 — Payment Webhook Validation Schemas
// =============================================================================
// Webhook payloads are validated by provider signature verification rather
// than field-level validation. These schemas exist for OpenAPI documentation.
// =============================================================================

const stripeWebhook = {
  id: { type: 'string', required: true },
  type: { type: 'string', required: true },
};

const conektaWebhook = {
  id: { type: 'string', required: true },
  type: { type: 'string', required: true },
};

module.exports = { stripeWebhook, conektaWebhook };
