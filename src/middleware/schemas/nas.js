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
  // RouterOS direct-provisioning API connection (migration 360). api_password is
  // the plaintext API password on input; the route encrypts it into
  // api_password_encrypted and never returns it.
  api_port: { type: 'number', min: 1, max: 65535 },
  api_username: { type: 'string', max: 128 },
  api_password: { type: 'string', max: 255 },
  api_use_tls: { type: 'boolean' },
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
  seedWalledGarden: { type: 'boolean' },
  suspendedListName: { type: 'string', max: 64 },
  portalAddress: { type: 'string', max: 255 },
};

module.exports = { createNas, updateNas, seedNas };
