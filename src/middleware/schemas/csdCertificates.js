// =============================================================================
// FireISP 5.0 — CSD Certificate Validation Schemas
// =============================================================================
// Upload takes the RAW .cer/.key files (base64) + passphrase — the server
// parses and validates them (RFC, validity, pair match) itself. The old shape
// trusted the CLIENT to send rfc/certificate_number/cer_pem, which let any
// caller store arbitrary unverified "certificates".
// =============================================================================

const uploadCsdCertificate = {
  // DER .cer files are ~1.5 KB, .key ~1.3 KB → base64 ~2 KB; generous caps.
  cer_b64: { type: 'string', required: true, max: 20000 },
  key_b64: { type: 'string', required: true, max: 20000 },
  passphrase: { type: 'string', required: true, max: 256 },
};

// Certificates are immutable once stored — only the lifecycle status moves
// (revoked by hand; expired is set by the expiry monitor). Replacing a cert
// means uploading its successor and activating it.
const updateCsdCertificate = {
  status: { type: 'string', enum: ['active', 'expired', 'revoked'] },
};

module.exports = { uploadCsdCertificate, updateCsdCertificate };
