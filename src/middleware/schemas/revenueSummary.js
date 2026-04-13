// =============================================================================
// FireISP 5.0 — Revenue Summary Validation Schemas
// =============================================================================

const listRevenueSummary = {
  period_date: { type: 'string' },
  currency: { type: 'string', max: 3 },
  page: { type: 'number', min: 1 },
  limit: { type: 'number', min: 1, max: 100 },
};

module.exports = { listRevenueSummary };
