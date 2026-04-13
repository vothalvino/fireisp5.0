// =============================================================================
// FireISP 5.0 — Export Validation Schemas
// =============================================================================
// CSV export endpoints accept optional date-range filters.
// =============================================================================

const exportQuery = {
  date_from: { type: 'string' },
  date_to: { type: 'string' },
  status: { type: 'string' },
  currency: { type: 'string', max: 3 },
};

module.exports = { exportQuery };
