// =============================================================================
// FireISP 5.0 — FireRelay Validation Schemas
// =============================================================================

const firerelayNode = {
  id: { type: 'string', required: true, min: 1, max: 64 },
  name: { type: 'string', max: 255 },
  api_url: { type: 'string', required: true, min: 1, max: 512 },
};

const firerelayNodeUpdate = {
  name: { type: 'string', max: 255 },
  api_url: { type: 'string', max: 512 },
  status: { type: 'string', enum: ['active', 'draining', 'maintenance', 'offline'] },
  client_count: { type: 'number', min: 0 },
  device_count: { type: 'number', min: 0 },
  cpu_percent: { type: 'number', min: 0, max: 100 },
  memory_percent: { type: 'number', min: 0, max: 100 },
  disk_percent: { type: 'number', min: 0, max: 100 },
  db_size_mb: { type: 'number', min: 0 },
  uptime_seconds: { type: 'number', min: 0 },
  last_seen_at: { type: 'string', max: 30 },
};

module.exports = { firerelayNode, firerelayNodeUpdate };
