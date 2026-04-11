// =============================================================================
// FireISP 5.0 — CfdiRelatedDocument Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CfdiRelatedDocument extends BaseModel {
  static get tableName() { return 'cfdi_related_documents'; }
  static get fillable() { return ['cfdi_document_id', 'related_uuid', 'tipo_relacion']; }
  static get hasOrgScope() { return false; }
}

module.exports = CfdiRelatedDocument;
