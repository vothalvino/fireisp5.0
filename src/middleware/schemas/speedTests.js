// =============================================================================
// FireISP 5.0 — Speed Test Validation Schemas
// =============================================================================

const createSpeedTest = {
  contract_id: { type: 'number', min: 1 },
  device_id: { type: 'number', min: 1 },
  download_mbps: { type: 'number', required: true, min: 0 },
  upload_mbps: { type: 'number', required: true, min: 0 },
  latency_ms: { type: 'number', min: 0 },
  jitter_ms: { type: 'number', min: 0 },
  packet_loss_pct: { type: 'number', min: 0, max: 100 },
  test_source: { type: 'string', enum: ['client_portal', 'technician', 'automated_probe', 'external'] },
  server_location: { type: 'string', max: 255 },
  notes: { type: 'string', max: 5000 },
};

const updateSpeedTest = {
  download_mbps: { type: 'number', min: 0 },
  upload_mbps: { type: 'number', min: 0 },
  latency_ms: { type: 'number', min: 0 },
  jitter_ms: { type: 'number', min: 0 },
  packet_loss_pct: { type: 'number', min: 0, max: 100 },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createSpeedTest, updateSpeedTest };
