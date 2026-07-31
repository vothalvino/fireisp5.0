// =============================================================================
// FireISP 5.0 — Speed Test Validation Schemas
// =============================================================================

const createSpeedTest = {
  // client_id and tested_at are both in the model's fillable and were both
  // missing here. validate() IGNORES undeclared fields rather than stripping
  // them, so they reached the INSERT unvalidated — and tested_at going
  // undocumented is why POST returned a hard 500 before migration 438 gave the
  // column a default (TIMESTAMP NOT NULL with no DEFAULT under MySQL 8's
  // explicit_defaults_for_timestamp).
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  device_id: { type: 'number', min: 1 },
  tested_at: { type: 'string' },
  download_mbps: { type: 'number', required: true, min: 0 },
  upload_mbps: { type: 'number', required: true, min: 0 },
  latency_ms: { type: 'number', min: 0 },
  jitter_ms: { type: 'number', min: 0 },
  packet_loss_pct: { type: 'number', min: 0, max: 100 },
  // NOT NULL with no default, exactly like tested_at was: optional here meant a
  // POST without it died as a 500 instead of a 422 naming the field.
  test_source: { type: 'string', required: true, enum: ['client_portal', 'technician', 'automated_probe', 'external'] },
  // Bounds mirror the column widths — server_location is VARCHAR(150), not 255,
  // and the old 255 let a legal-looking value through to a strict-mode
  // ER_DATA_TOO_LONG (another 500).
  server_location: { type: 'string', max: 150 },
  ip_address: { type: 'string', max: 45 },
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
