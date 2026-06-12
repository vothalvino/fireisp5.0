'use strict';

// =============================================================================
// FireISP 5.0 — Subscriber Speed Test Job Validation Schemas (§10.4)
// =============================================================================

const createSpeedTestJob = {
  contract_id:     { type: 'number', required: true, min: 1 },
  test_server_id:  { type: 'number', min: 1 },
  scheduled_at:    { type: 'string', max: 30 },
  notes:           { type: 'string', max: 1000 },
};

const updateSpeedTestJob = {
  status:          { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] },
  download_mbps:   { type: 'number', min: 0 },
  upload_mbps:     { type: 'number', min: 0 },
  latency_ms:      { type: 'number', min: 0 },
  jitter_ms:       { type: 'number', min: 0 },
  packet_loss_pct: { type: 'number', min: 0, max: 100 },
  error_message:   { type: 'string', max: 2000 },
  notes:           { type: 'string', max: 1000 },
};

module.exports = { createSpeedTestJob, updateSpeedTestJob };
