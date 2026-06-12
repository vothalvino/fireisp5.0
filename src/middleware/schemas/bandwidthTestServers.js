'use strict';

// =============================================================================
// FireISP 5.0 — Bandwidth Test Server Validation Schemas (§10.4)
// =============================================================================

const createBandwidthTestServer = {
  name:               { type: 'string', required: true, min: 1, max: 100 },
  description:        { type: 'string', max: 1000 },
  host:               { type: 'string', required: true, max: 255 },
  port:               { type: 'number', min: 1, max: 65535 },
  protocol:           { type: 'string', enum: ['tcp', 'udp', 'iperf3', 'speedtest'] },
  region:             { type: 'string', max: 100 },
  site_id:            { type: 'number', min: 1 },
  is_active:          { type: 'boolean' },
  auth_token:         { type: 'string', max: 255 },
  max_bandwidth_mbps: { type: 'number', min: 0 },
  status:             { type: 'string', enum: ['active', 'inactive', 'maintenance'] },
};

const updateBandwidthTestServer = {
  name:               { type: 'string', min: 1, max: 100 },
  description:        { type: 'string', max: 1000 },
  host:               { type: 'string', max: 255 },
  port:               { type: 'number', min: 1, max: 65535 },
  protocol:           { type: 'string', enum: ['tcp', 'udp', 'iperf3', 'speedtest'] },
  region:             { type: 'string', max: 100 },
  site_id:            { type: 'number', min: 1 },
  is_active:          { type: 'boolean' },
  auth_token:         { type: 'string', max: 255 },
  max_bandwidth_mbps: { type: 'number', min: 0 },
  status:             { type: 'string', enum: ['active', 'inactive', 'maintenance'] },
};

module.exports = { createBandwidthTestServer, updateBandwidthTestServer };
