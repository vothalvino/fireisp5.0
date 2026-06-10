// =============================================================================
// FireISP 5.0 — Cash Reconciliation Validation Schemas
// =============================================================================

const openSessionSchema = {
  notes: { type: 'string' },
};

const closeSessionSchema = {
  counted_total: { type: 'number', required: true, min: 0 },
};

module.exports = { openSessionSchema, closeSessionSchema };
