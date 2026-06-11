// =============================================================================
// FireISP 5.0 — IP Pool Validation Schemas
// =============================================================================

const createIpPool = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  network: { type: 'string', required: true, max: 45 },
  subnet_mask: { type: 'string', max: 45 },
  gateway: { type: 'string', max: 45 },
  ip_version: { type: 'string', enum: ['4', '6'] },
  dns_primary: { type: 'string', max: 45 },
  dns_secondary: { type: 'string', max: 45 },
  pool_type: { type: 'string', max: 50 },
  site_id: { type: 'number', min: 1 },
  nas_id: { type: 'number', min: 1 },
  service_type: { type: 'string', enum: ['residential', 'business', 'corporate', 'government', 'mixed'] },
  default_prefix_len: { type: 'number', min: 48, max: 128 },
  excluded_ranges: { type: 'string', max: 10000 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateIpPool = {
  name: { type: 'string', min: 1, max: 255 },
  network: { type: 'string', max: 45 },
  subnet_mask: { type: 'string', max: 45 },
  gateway: { type: 'string', max: 45 },
  ip_version: { type: 'string', enum: ['4', '6'] },
  dns_primary: { type: 'string', max: 45 },
  dns_secondary: { type: 'string', max: 45 },
  pool_type: { type: 'string', max: 50 },
  site_id: { type: 'number', min: 1 },
  nas_id: { type: 'number', min: 1 },
  service_type: { type: 'string', enum: ['residential', 'business', 'corporate', 'government', 'mixed'] },
  default_prefix_len: { type: 'number', min: 48, max: 128 },
  excluded_ranges: { type: 'string', max: 10000 },
  notes: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createIpPool, updateIpPool };
