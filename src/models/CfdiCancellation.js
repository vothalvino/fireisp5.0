// =============================================================================
// FireISP 5.0 — CfdiCancellation Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CfdiCancellation extends BaseModel {
  static get tableName() { return 'cfdi_cancellations'; }
  static get fillable() { return ['organization_id', 'cfdi_document_id', 'motivo', 'folio_sustitucion', 'cancellation_status', 'sat_response']; }
  static get hasOrgScope() { return true; }
}

module.exports = CfdiCancellation;
