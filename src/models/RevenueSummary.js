// =============================================================================
// FireISP 5.0 — RevenueSummary Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RevenueSummary extends BaseModel {
  static get tableName() { return 'revenue_summary'; }
  static get fillable() { return ['organization_id', 'period_date', 'total_invoiced', 'total_collected', 'total_outstanding', 'total_overdue', 'currency']; }
  static get hasOrgScope() { return true; }
}

module.exports = RevenueSummary;
