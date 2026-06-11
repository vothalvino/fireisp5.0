// =============================================================================
// FireISP 5.0 — PPPoE Service Profile Validation Schemas
// =============================================================================

const createPppoeServiceProfile = {
  name: { type: 'string', required: true, min: 1, max: 100 },
  service_name: { type: 'string', max: 64 },
  mtu: { type: 'number', min: 576, max: 9000 },
  mru: { type: 'number', min: 576, max: 9000 },
  auth_methods: { type: 'string', max: 100 },
  dns_primary: { type: 'string', max: 45 },
  dns_secondary: { type: 'string', max: 45 },
  session_timeout_seconds: { type: 'number', min: 0 },
  idle_timeout_seconds: { type: 'number', min: 0 },
  rate_limit_override: { type: 'string', max: 100 },
  address_list: { type: 'string', max: 100 },
  filter_id: { type: 'string', max: 100 },
  ipv6cp_enabled: { type: 'boolean' },
  delegated_prefix_len: { type: 'number', min: 48, max: 128 },
  dns_primary_v6: { type: 'string', max: 45 },
  dns_secondary_v6: { type: 'string', max: 45 },
  nat64_enabled: { type: 'boolean' },
  dns64_prefix: { type: 'string', max: 50 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

const updatePppoeServiceProfile = {
  name: { type: 'string', min: 1, max: 100 },
  service_name: { type: 'string', max: 64 },
  mtu: { type: 'number', min: 576, max: 9000 },
  mru: { type: 'number', min: 576, max: 9000 },
  auth_methods: { type: 'string', max: 100 },
  dns_primary: { type: 'string', max: 45 },
  dns_secondary: { type: 'string', max: 45 },
  session_timeout_seconds: { type: 'number', min: 0 },
  idle_timeout_seconds: { type: 'number', min: 0 },
  rate_limit_override: { type: 'string', max: 100 },
  address_list: { type: 'string', max: 100 },
  filter_id: { type: 'string', max: 100 },
  ipv6cp_enabled: { type: 'boolean' },
  delegated_prefix_len: { type: 'number', min: 48, max: 128 },
  dns_primary_v6: { type: 'string', max: 45 },
  dns_secondary_v6: { type: 'string', max: 45 },
  nat64_enabled: { type: 'boolean' },
  dns64_prefix: { type: 'string', max: 50 },
  status: { type: 'string', enum: ['active', 'inactive'] },
  notes: { type: 'string', max: 5000 },
};

module.exports = { createPppoeServiceProfile, updatePppoeServiceProfile };
