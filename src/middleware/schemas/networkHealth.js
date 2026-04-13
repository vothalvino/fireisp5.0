// =============================================================================
// FireISP 5.0 — Network Health Validation Schemas
// =============================================================================

const listNetworkHealth = {
  device_id: { type: 'number', min: 1 },
  network_link_id: { type: 'number', min: 1 },
  date_from: { type: 'string' },
  date_to: { type: 'string' },
  page: { type: 'number', min: 1 },
  limit: { type: 'number', min: 1, max: 100 },
};

module.exports = { listNetworkHealth };
