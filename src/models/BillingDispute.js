// =============================================================================
// FireISP 5.0 — BillingDispute Model
// =============================================================================

const BaseModel = require('./BaseModel');

class BillingDispute extends BaseModel {
  static get tableName() { return 'billing_disputes'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'invoice_id', 'payment_id',
      'type', 'status', 'description', 'resolution_notes',
      'opened_by', 'resolved_by', 'resolved_at',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = BillingDispute;
