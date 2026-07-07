// =============================================================================
// FireISP 5.0 — RegulatoryFiling Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RegulatoryFiling extends BaseModel {
  static get tableName() { return 'regulatory_filings'; }

  static get fillable() {
    return [
      'organization_id', 'concession_title_id', 'filing_type',
      'period_start', 'period_end', 'filed_at', 'acknowledgement_number',
      'document_file_id', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = RegulatoryFiling;
