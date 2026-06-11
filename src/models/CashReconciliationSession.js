// =============================================================================
// FireISP 5.0 — CashReconciliationSession Model
// =============================================================================

const BaseModel = require('./BaseModel');

class CashReconciliationSession extends BaseModel {
  static get tableName() { return 'cash_reconciliation_sessions'; }

  static get fillable() {
    return [
      'organization_id', 'agent_user_id', 'opened_at', 'closed_at',
      'expected_total', 'counted_total', 'variance', 'status', 'notes',
      'approved_by', 'approved_at',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = CashReconciliationSession;
