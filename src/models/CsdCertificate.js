// =============================================================================
// FireISP 5.0 — CsdCertificate Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CsdCertificate extends BaseModel {
  static get tableName() { return 'csd_certificates'; }

  // Lifecycle-only: certificates are immutable once uploaded. The upload
  // route inserts with raw SQL after server-side parsing/validation, so
  // keeping cer_pem/key material in fillable would let a generic PUT
  // overwrite a validated certificate with arbitrary unvalidated bytes
  // (validate() ignores-but-does-not-strip undeclared fields).
  static get fillable() {
    return ['status'];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = CsdCertificate;
