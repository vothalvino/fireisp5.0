// =============================================================================
// FireISP 5.0 — Expense Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Expense extends BaseModel {
  static get tableName() { return 'expenses'; }

  static get fillable() {
    return [
      'organization_id', 'job_id', 'category', 'description', 'amount',
      'currency', 'vendor', 'receipt_url', 'expense_date', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Expense;
