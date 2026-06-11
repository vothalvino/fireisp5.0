// =============================================================================
// FireISP 5.0 — NAS Validation Schemas
// =============================================================================

const createNas = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  ip_address: { type: 'string', required: true, max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  secret: { type: 'string', required: true, min: 1, max: 255 },
  type: { type: 'string', max: 50 },
  ports: { type: 'number', min: 0 },
  coa_port: { type: 'number', min: 1, max: 65535 },
  location: { type: 'string', max: 200 },
  site_id: { type: 'number', min: 1 },
  secondary_nas_id: { type: 'number', min: 1 },
  health_status: { type: 'string', enum: ['unknown', 'up', 'down'] },
  description: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

const updateNas = {
  name: { type: 'string', min: 1, max: 255 },
  ip_address: { type: 'string', max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  secret: { type: 'string', min: 1, max: 255 },
  type: { type: 'string', max: 50 },
  ports: { type: 'number', min: 0 },
  coa_port: { type: 'number', min: 1, max: 65535 },
  location: { type: 'string', max: 200 },
  site_id: { type: 'number', min: 1 },
  secondary_nas_id: { type: 'number', min: 1 },
  health_status: { type: 'string', enum: ['unknown', 'up', 'down'] },
  description: { type: 'string', max: 5000 },
  status: { type: 'string', enum: ['active', 'inactive'] },
};

module.exports = { createNas, updateNas };
