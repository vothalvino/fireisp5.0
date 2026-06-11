// =============================================================================
// FireISP 5.0 — Discovery Scan Validation Schemas
// =============================================================================

const createDiscoveryScan = {
  name: { type: 'string', minLength: 1, maxLength: 200, required: true },
  cidr_ranges: { type: 'array', items: { type: 'string', maxLength: 50 }, minItems: 1, maxItems: 100, required: true },
  snmp_version: { type: 'string', enum: ['v1', 'v2c', 'v3'] },
  snmp_community: { type: 'string', maxLength: 255 },
  snmp_v3_security_name: { type: 'string', maxLength: 255 },
  snmp_v3_auth_protocol: { type: 'string', enum: ['none', 'md5', 'sha', 'sha256', 'sha512'] },
  snmp_v3_auth_key: { type: 'string', maxLength: 255 }, // plaintext in request, encrypted before store
  snmp_v3_priv_protocol: { type: 'string', enum: ['none', 'des', 'aes128', 'aes256'] },
  snmp_v3_priv_key: { type: 'string', maxLength: 255 }, // plaintext in request, encrypted before store
  snmp_port: { type: 'number', minimum: 1, maximum: 65535 },
  timeout_ms: { type: 'number', minimum: 500, maximum: 30000 },
  concurrency: { type: 'number', minimum: 1, maximum: 200 },
};

const updateDiscoveryScan = { ...createDiscoveryScan };
delete updateDiscoveryScan.name;
updateDiscoveryScan.name = { type: 'string', minLength: 1, maxLength: 200 };

module.exports = { createDiscoveryScan, updateDiscoveryScan };
