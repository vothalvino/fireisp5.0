// =============================================================================
// FireISP 5.0 — Security Validation Schemas (§17)
// =============================================================================

const createFirewallRule = {
  action: { required: true, enum: ['allow', 'deny', 'log'] },
  protocol: { required: true, enum: ['tcp', 'udp', 'icmp', 'any'] },
  priority: { type: 'integer' },
  name: {},
  description: {},
  src_ip: {},
  src_port: {},
  dst_ip: {},
  dst_port: {},
  direction: { enum: ['inbound', 'outbound', 'both'] },
};

const createDdosRule = {
  rule_type: { required: true, enum: ['flowspec', 'rtbh'] },
  target_prefix: { required: true },
  action: { required: true, enum: ['drop', 'ratelimit', 'redirect'] },
  name: {},
  threshold_pps: { type: 'number' },
  threshold_bps: { type: 'number' },
  notes: {},
};

const createBlackholeRoute = {
  // Accepts `prefix` (new schema column) or legacy `target_prefix` — route maps either.
  prefix: {},
  target_prefix: {},
  reason: { required: true },
  notes: {},
};

const createDnsBlocklist = {
  domain: { required: true },
  category: { required: true, enum: ['malware', 'phishing', 'ads', 'spam', 'adult', 'gambling', 'botnet', 'other'] },
  // New schema columns; legacy `source` also accepted by the route handler.
  entry_type: { enum: ['manual', 'auto_import', 'threat_feed'] },
  threat_feed_source: {},
  source: {},
  is_active: { type: 'boolean' },
};

const createWebAuthn = {
  credential_id: { required: true },
  public_key: { required: true },
  friendly_name: {},
  aaguid: {},
  transports: {},
};

const updatePasswordPolicy = {
  min_length: { type: 'integer', min: 8, max: 128 },
  require_uppercase: { type: 'boolean' },
  require_lowercase: { type: 'boolean' },
  require_digits: { type: 'boolean' },
  // New schema column name; legacy require_symbols also accepted by the route handler.
  require_special_chars: { type: 'boolean' },
  require_symbols: { type: 'boolean' },
  max_repeated_chars: { type: 'integer', min: 0 },
  rotation_days: { type: 'integer', min: 0 },
  history_count: { type: 'integer', min: 0 },
  lockout_attempts: { type: 'integer', min: 0 },
  lockout_duration_minutes: { type: 'integer', min: 0 },
};

const createAdminIpAllowlist = {
  // Accepts `cidr` (new schema column) or legacy `ip_address` — route maps either.
  cidr: {},
  ip_address: {},
  description: {},
  is_active: { type: 'boolean' },
};

const triggerCpeScan = {
  scan_type: { required: true, enum: ['default_credentials', 'open_ports', 'firmware_cve', 'configuration_audit', 'full'] },
  device_id: { type: 'number' },
  cpe_device_id: { type: 'number' },
};

module.exports = {
  createFirewallRule,
  createDdosRule,
  createBlackholeRoute,
  createDnsBlocklist,
  createWebAuthn,
  updatePasswordPolicy,
  createAdminIpAllowlist,
  triggerCpeScan,
};
