// =============================================================================
// FireISP 5.0 — NAS Validation Schemas
// =============================================================================

const createNas = {
  name: { type: 'string', required: true, min: 1, max: 255 },
  // ip_address is required when access_mode is 'direct' (or absent); for 'nated'
  // it is omitted — the route allocates the WG tunnel address and uses that.
  // Conditional enforcement is handled by the validateNasIpAddress middleware in
  // nas.js; here the field is declared optional so validate() doesn't reject early.
  ip_address: { type: 'string', max: 45 },
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
  // RouterOS direct-provisioning API connection (migration 360). api_password is
  // the plaintext API password on input; the route encrypts it into
  // api_password_encrypted and never returns it.
  api_port: { type: 'number', min: 1, max: 65535 },
  api_username: { type: 'string', max: 128 },
  api_password: { type: 'string', max: 255 },
  api_use_tls: { type: 'boolean' },
  // Per-NAS connectivity mode (migration 371)
  access_mode: { type: 'string', enum: ['direct', 'nated'] },
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
  // RouterOS direct-provisioning API connection (migration 360). api_password is
  // the plaintext API password on input; the route encrypts it into
  // api_password_encrypted and never returns it.
  api_port: { type: 'number', min: 1, max: 65535 },
  api_username: { type: 'string', max: 128 },
  api_password: { type: 'string', max: 255 },
  api_use_tls: { type: 'boolean' },
  // Per-NAS connectivity mode (migration 371)
  access_mode: { type: 'string', enum: ['direct', 'nated'] },
};

// Seed (one-click bootstrap) parameters for POST /nas/:id/seed. Flat scalars so
// the field-level validate() middleware can check them; the route reads the NAS
// `secret` server-side (never sent by the client). See routerProvisioningService.seedDevice.
const seedNas = {
  radiusAddress: { type: 'string', required: true, min: 1, max: 255 },
  authPort: { type: 'number', min: 1, max: 65535 },
  acctPort: { type: 'number', min: 1, max: 65535 },
  coaPort: { type: 'number', min: 1, max: 65535 },
  interimUpdate: { type: 'string', max: 16 },
  seedQueueTree: { type: 'boolean' },
  queueParent: { type: 'string', max: 64 },
  totalDownloadMbps: { type: 'number', min: 0, max: 1000000 },
  totalUploadMbps: { type: 'number', min: 0, max: 1000000 },
  // §3 fq-codel queue types; §4 Business/Residential priority simple queues
  // (reuse totalDownloadMbps/totalUploadMbps as the POP limit).
  seedQueueTypes: { type: 'boolean' },
  seedPriorityQueues: { type: 'boolean' },
  // §2 PPPoE server + base profile. pppoeInterface is required by the service
  // when seedPppoeServer is set (validated there → skipped step if absent).
  seedPppoeServer: { type: 'boolean' },
  pppoeInterface: { type: 'string', max: 64 },
  pppoeServiceName: { type: 'string', max: 64 },
  pppoeProfileName: { type: 'string', max: 64 },
  pppoeLocalAddress: { type: 'string', max: 45 },
  pppoeParentQueue: { type: 'string', max: 64 },
  seedWalledGarden: { type: 'boolean' },
  suspendedListName: { type: 'string', max: 64 },
  portalAddress: { type: 'string', max: 255 },
  // §5 walled-garden redirect tuning: ports it matches, the portal's listen port,
  // and whether it is laid down live (permanent) or disabled on create.
  redirectPorts: { type: 'string', max: 64 },
  redirectToPort: { type: 'number', min: 1, max: 65535 },
  redirectEnabled: { type: 'boolean' },
  // Real-time (VoIP / calling) priority: classify → DSCP EF → priority-1 queue.
  seedRealtimePriority: { type: 'boolean' },
  sipRtpPorts: { type: 'string', max: 128 },
  voipNetworks: { type: 'string', max: 2000 },
  trustClientDscp: { type: 'boolean' },
  realtimeParent: { type: 'string', max: 64 },
  realtimeMaxMbps: { type: 'number', min: 0, max: 1000000 },
};

// Confirm WireGuard routed subnets for PUT /nas/:id/wg/routes.
// The caller sends a `subnets` array of CIDR strings; the server validates
// and stores them in nas_wg_tunnels.routed_subnets.
const confirmWgRoutes = {
  subnets: { type: 'array', required: true },
};

module.exports = { createNas, updateNas, seedNas, confirmWgRoutes };
