// =============================================================================
// FireISP 5.0 — PDF Export Validation Schemas
// =============================================================================
// PDF endpoints take an :id route parameter. These schemas document the
// routes for the OpenAPI spec.
// =============================================================================

const pdfById = {
  id: { type: 'number', required: true, min: 1 },
};

module.exports = { pdfById };
