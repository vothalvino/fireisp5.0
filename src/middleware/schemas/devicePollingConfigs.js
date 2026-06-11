// =============================================================================
// FireISP 5.0 — Validation schemas: Device Polling Configs (§6.4)
// =============================================================================

const createDevicePollingConfig = {
  device_id:                 { type: 'number', min: 1 },
  device_type:               { type: 'string', max: 50 },
  poller_node_id:            { type: 'number', min: 1 },
  poll_interval_sec:         { type: 'number', min: 10, max: 86400 },
  bulk_get_enabled:          { type: 'boolean' },
  max_repetitions:           { type: 'number', min: 1, max: 100 },
  timeout_ms:                { type: 'number', min: 100, max: 60000 },
  retries:                   { type: 'number', min: 0, max: 10 },
  failover_node_id:          { type: 'number', min: 1 },
  adaptive_polling_enabled:  { type: 'boolean' },
  adaptive_min_interval_sec: { type: 'number', min: 10, max: 3600 },
  is_enabled:                { type: 'boolean' },
};

const updateDevicePollingConfig = { ...createDevicePollingConfig };

module.exports = { createDevicePollingConfig, updateDevicePollingConfig };
