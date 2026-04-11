// =============================================================================
// FireISP 5.0 — RegulatoryFiling Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RegulatoryFiling extends BaseModel {
  static get tableName() { return 'regulatory_filings'; }

  static get fillable() {
    return [
      'organization_id', 'filing_type', 'period_start', 'period_end',
      'due_date', 'submitted_at', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = RegulatoryFiling;
