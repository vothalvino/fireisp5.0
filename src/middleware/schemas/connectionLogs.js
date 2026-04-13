// =============================================================================
// FireISP 5.0 — Connection Log Validation Schemas
// =============================================================================

const listConnectionLogs = {
  contract_id: { type: 'number', min: 1 },
  client_id: { type: 'number', min: 1 },
  ip_address: { type: 'string', max: 45 },
  event_type: { type: 'string', enum: ['start', 'stop', 'interim-update', 'coa', 'disconnect'] },
  date_from: { type: 'string' },
  date_to: { type: 'string' },
  page: { type: 'number', min: 1 },
  limit: { type: 'number', min: 1, max: 100 },
};

module.exports = { listConnectionLogs };
