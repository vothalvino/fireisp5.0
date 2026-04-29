// =============================================================================
// FireISP 5.0 — AiForbiddenTerm Model
// =============================================================================
// Words or phrases that must never appear in an AI-generated draft.
// The output validator rejects any draft containing one of these terms,
// triggering a regeneration attempt or a manual-review fallback.
// =============================================================================

const BaseModel = require('./BaseModel');

class AiForbiddenTerm extends BaseModel {
  static get tableName() { return 'ai_forbidden_terms'; }

  static get fillable() {
    return [
      'organization_id',
      'locale',
      'term',
      'replacement',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = AiForbiddenTerm;
