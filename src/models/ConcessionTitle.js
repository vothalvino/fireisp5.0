// =============================================================================
// FireISP 5.0 — ConcessionTitle Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ConcessionTitle extends BaseModel {
  static get tableName() { return 'concession_titles'; }

  static get fillable() {
    return [
      'organization_id', 'title_number', 'title_type',
      'authorized_services', 'spectrum_bands', 'valid_from', 'valid_to',
      'regulatory_status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = ConcessionTitle;
