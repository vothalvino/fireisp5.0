// =============================================================================
// FireISP 5.0 — Promotion Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Promotion extends BaseModel {
  static get tableName() { return 'promotions'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'code', 'discount_type', 'discount_value',
      'promotion_type', 'applies_to', 'start_date', 'end_date', 'max_uses',
      'used_count', 'status',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = Promotion;
