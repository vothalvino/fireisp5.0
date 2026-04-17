// =============================================================================
// FireISP 5.0 — CsdCertificate Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CsdCertificate extends BaseModel {
  static get tableName() { return 'csd_certificates'; }

  static get fillable() {
    return [
      'organization_id', 'certificate_pem', 'private_key_encrypted',
      'passphrase_encrypted', 'fingerprint_sha256', 'certificate_number',
      'rfc', 'valid_from', 'valid_to', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = CsdCertificate;
