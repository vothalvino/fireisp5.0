// =============================================================================
// FireISP 5.0 — Subscriber Certificate Validation Schemas
// =============================================================================

const createSubscriberCertificate = {
  radius_account_id: { type: 'number', min: 1 },
  client_id: { type: 'number', min: 1 },
  common_name: { type: 'string', required: true, min: 1, max: 255 },
  serial_number: { type: 'string', required: true, min: 1, max: 100 },
  fingerprint_sha256: { type: 'string', required: true, min: 64, max: 64 },
  valid_from: { type: 'string', required: true },
  valid_until: { type: 'string', required: true },
  status: { type: 'string', enum: ['active', 'revoked', 'expired'] },
};

const updateSubscriberCertificate = {
  common_name: { type: 'string', min: 1, max: 255 },
  status: { type: 'string', enum: ['active', 'revoked', 'expired'] },
  revocation_reason: { type: 'string', max: 255 },
};

const revokeSubscriberCertificate = {
  revocation_reason: { type: 'string', max: 255 },
};

module.exports = {
  createSubscriberCertificate,
  updateSubscriberCertificate,
  revokeSubscriberCertificate,
};
