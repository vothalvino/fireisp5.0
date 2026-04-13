// =============================================================================
// FireISP 5.0 — Prometheus Metrics Validation Schemas
// =============================================================================
// The /metrics endpoint is parameter-free but we declare a schema for the
// OpenAPI spec to document its existence.
// =============================================================================

const metricsQuery = {
  // No query parameters — returns full Prometheus metrics text
};

module.exports = { metricsQuery };
