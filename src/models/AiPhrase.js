// =============================================================================
// FireISP 5.0 — AiPhrase Model
// =============================================================================
// Curated on-brand reply phrases, grouped by locale and category.
// The LLM is constrained to draw from (or must include) these phrases so that
// replies remain consistent with the operator's communication style.
// =============================================================================

const BaseModel = require('./BaseModel');

class AiPhrase extends BaseModel {
  static get tableName() { return 'ai_phrase_library'; }

  static get fillable() {
    return [
      'organization_id',
      'locale',
      'category',
      'text',
      'is_required',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = AiPhrase;
