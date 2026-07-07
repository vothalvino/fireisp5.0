// =============================================================================
// FireISP 5.0 — CSD Certificate Validation Schemas
// =============================================================================

const createCsdCertificate = {
  rfc: { type: 'string', required: true, min: 12, max: 13 },
  certificate_number: { type: 'string', max: 20 },
  cer_pem: { type: 'string', required: true },
  key_pem_encrypted: { type: 'string', required: true },
  valid_from: { type: 'string' },
  valid_to: { type: 'string' },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

const updateCsdCertificate = {
  cer_pem: { type: 'string' },
  key_pem_encrypted: { type: 'string' },
  valid_from: { type: 'string' },
  valid_to: { type: 'string' },
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

module.exports = { createCsdCertificate, updateCsdCertificate };
