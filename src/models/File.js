// =============================================================================
// FireISP 5.0 — File Model
// =============================================================================

const BaseModel = require('./BaseModel');

class File extends BaseModel {
  static get tableName() { return 'files'; }

  static get fillable() {
    return [
      'organization_id', 'entity_type', 'entity_id', 'category',
      'filename', 'original_filename', 'mime_type', 'size_bytes',
      'path', 'storage_provider',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = File;
