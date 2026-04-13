// =============================================================================
// FireISP 5.0 — Dashboard Validation Schemas
// =============================================================================
// Dashboard endpoints are all GET-only. These schemas document the query
// parameters accepted by each endpoint for the OpenAPI spec.
// =============================================================================

const summaryQuery = {
  // No query parameters — summary is scoped to the org via middleware
};

const revenueQuery = {
  months: { type: 'number', min: 1, max: 36 },
};

const overdueQuery = {
  page: { type: 'number', min: 1 },
  limit: { type: 'number', min: 1, max: 100 },
};

module.exports = { summaryQuery, revenueQuery, overdueQuery };
