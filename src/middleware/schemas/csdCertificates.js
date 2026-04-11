// =============================================================================
// FireISP 5.0 — CSD Certificate Validation Schemas
// =============================================================================

const createCsdCertificate = {
  rfc: { type: 'string', required: true, min: 12, max: 13 },
  certificate_number: { type: 'string', max: 20 },
  certificate_pem: { type: 'string', required: true },
  private_key_encrypted: { type: 'string', required: true },
  valid_from: { type: 'string' },
  valid_to: { type: 'string' },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

const updateCsdCertificate = {
  certificate_pem: { type: 'string' },
  private_key_encrypted: { type: 'string' },
  valid_from: { type: 'string' },
  valid_to: { type: 'string' },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

module.exports = { createCsdCertificate, updateCsdCertificate };
