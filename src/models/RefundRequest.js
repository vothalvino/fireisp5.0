// =============================================================================
// FireISP 5.0 — RefundRequest Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RefundRequest extends BaseModel {
  static get tableName() { return 'refund_requests'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'payment_id', 'invoice_id',
      'amount', 'reason', 'status',
      'requested_by', 'reviewed_by', 'review_notes',
      'processed_at', 'refund_method', 'resulting_credit_note_id',
      'gateway_refund_reference',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = RefundRequest;
