// =============================================================================
// FireISP 5.0 — RateLimitTemplate Validation Schemas
// =============================================================================

const createRateLimitTemplate = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  description: { type: 'string', max: 5000 },
  service_type: { type: 'string', enum: ['pppoe', 'dhcp', 'hotspot', 'static', 'other'] },
  radius_vendor: { type: 'string', enum: ['mikrotik', 'cisco', 'juniper', 'generic'] },
  download_mbps: { type: 'number', required: true, min: 0 },
  upload_mbps: { type: 'number', required: true, min: 0 },
  burst_download_mbps: { type: 'number', min: 0 },
  burst_upload_mbps: { type: 'number', min: 0 },
  burst_threshold_mbps: { type: 'number', min: 0 },
  burst_time_seconds: { type: 'number', min: 1, max: 255 },
  priority: { type: 'number', min: 1, max: 8 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateRateLimitTemplate = {
  name: { type: 'string', min: 1, max: 100 },
  description: { type: 'string', max: 5000 },
  service_type: { type: 'string', enum: ['pppoe', 'dhcp', 'hotspot', 'static', 'other'] },
  radius_vendor: { type: 'string', enum: ['mikrotik', 'cisco', 'juniper', 'generic'] },
  download_mbps: { type: 'number', min: 0 },
  upload_mbps: { type: 'number', min: 0 },
  burst_download_mbps: { type: 'number', min: 0 },
  burst_upload_mbps: { type: 'number', min: 0 },
  burst_threshold_mbps: { type: 'number', min: 0 },
  burst_time_seconds: { type: 'number', min: 1, max: 255 },
  priority: { type: 'number', min: 1, max: 8 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createRateLimitTemplate, updateRateLimitTemplate };
