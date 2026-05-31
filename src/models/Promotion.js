// =============================================================================
// FireISP 5.0 — Promotion Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Promotion extends BaseModel {
  static get tableName() { return 'promotions'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'code', 'description', 'discount_type',
      'discount_value', 'promotion_type', 'applies_to', 'max_uses',
      'max_uses_per_client', 'min_order_value', 'duration_months',
      'starts_at', 'ends_at', 'is_active',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Promotion;
