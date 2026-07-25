// =============================================================================
// FireISP 5.0 — CfdiRelatedDocument Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CfdiRelatedDocument extends BaseModel {
  static get tableName() { return 'cfdi_related_documents'; }
  // NOTE: the real column is `relationship_type` (schema.sql / migration 071) —
  // the old 'tipo_relacion' entry silently dropped the relation type on create.
  static get fillable() { return ['cfdi_document_id', 'related_uuid', 'relationship_type']; }
  static get hasOrgScope() { return false; }
}

module.exports = CfdiRelatedDocument;
