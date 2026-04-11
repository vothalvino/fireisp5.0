// =============================================================================
// FireISP 5.0 — Suspension Validation Schemas
// =============================================================================

const suspend = {
  contract_id: { type: 'number', required: true, min: 1 },
};

const reconnect = {
  contract_id: { type: 'number', required: true, min: 1 },
};

module.exports = { suspend, reconnect };
