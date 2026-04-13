// =============================================================================
// FireISP 5.0 — Audit Log Validation Schemas
// =============================================================================

const listAuditLogs = {
  user_id: { type: 'number', min: 1 },
  action: { type: 'string', enum: ['create', 'update', 'delete'] },
  table_name: { type: 'string', max: 100 },
  date_from: { type: 'string' },
  date_to: { type: 'string' },
  page: { type: 'number', min: 1 },
  limit: { type: 'number', min: 1, max: 100 },
};

module.exports = { listAuditLogs };
