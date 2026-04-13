// =============================================================================
// FireISP 5.0 — SSE Events Validation Schemas
// =============================================================================
// SSE endpoints are long-lived GET connections. These schemas document the
// route parameters for the OpenAPI spec.
// =============================================================================

const ticketStream = {
  id: { type: 'number', required: true, min: 1 },
};

module.exports = { ticketStream };
