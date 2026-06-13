// =============================================================================
// FireISP 5.0 — WebAuthnCredential Model
// =============================================================================

const BaseModel = require('./BaseModel');

class WebAuthnCredential extends BaseModel {
  static get tableName() { return 'webauthn_credentials'; }
  static get hasOrgScope() { return true; }
  static get softDelete() { return true; }
  static get fillable() {
    return ['organization_id', 'user_id', 'credential_id', 'public_key', 'friendly_name', 'aaguid', 'sign_count', 'transports', 'last_used_at'];
  }
}

module.exports = WebAuthnCredential;
