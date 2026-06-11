// =============================================================================
// FireISP 5.0 — RADIUS Validation Schemas
// =============================================================================

const createRadius = {
  client_id: { type: 'number', required: true, min: 1 },
  contract_id: { type: 'number', min: 1 },
  nas_id: { type: 'number', min: 1 },
  username: { type: 'string', required: true, min: 1, max: 64 },
  password: { type: 'string', required: true, min: 1, max: 255 },
  ip_address: { type: 'string', max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  mac_address: { type: 'string', max: 17 },
  profile: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
  auth_method: { type: 'string', enum: ['pppoe', 'mac', 'dot1x', 'eap_tls'] },
};

const updateRadius = {
  client_id: { type: 'number', min: 1 },
  contract_id: { type: 'number', min: 1 },
  nas_id: { type: 'number', min: 1 },
  username: { type: 'string', min: 1, max: 64 },
  password: { type: 'string', min: 1, max: 255 },
  ip_address: { type: 'string', max: 45 },
  ipv6_address: { type: 'string', max: 45 },
  mac_address: { type: 'string', max: 17 },
  profile: { type: 'string', max: 100 },
  status: { type: 'string', enum: ['active', 'inactive', 'suspended'] },
  auth_method: { type: 'string', enum: ['pppoe', 'mac', 'dot1x', 'eap_tls'] },
};

module.exports = { createRadius, updateRadius };
