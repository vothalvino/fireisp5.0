// =============================================================================
// FireISP 5.0 — EncryptionKeyMetadata Model
// =============================================================================

const BaseModel = require('./BaseModel');

class EncryptionKeyMetadata extends BaseModel {
  static get tableName() { return 'encryption_key_metadata'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'key_alias', 'algorithm', 'key_size', 'purpose', 'status', 'created_by', 'rotated_at', 'expires_at', 'notes'];
  }
}

module.exports = EncryptionKeyMetadata;
