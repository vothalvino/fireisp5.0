// =============================================================================
// FireISP 5.0 — EncryptionKeyMetadata Model
// =============================================================================

const BaseModel = require('./BaseModel');

class EncryptionKeyMetadata extends BaseModel {
  static get tableName() { return 'encryption_key_metadata'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'key_id', 'purpose', 'algorithm', 'key_length_bits', 'key_reference', 'status', 'version', 'rotated_at', 'expires_at', 'next_rotation_at', 'rotated_by', 'notes'];
  }
}

module.exports = EncryptionKeyMetadata;
