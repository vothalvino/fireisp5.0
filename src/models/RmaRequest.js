// =============================================================================
// FireISP 5.0 — RMA Request Model
// =============================================================================

const BaseModel = require('./BaseModel');

class RmaRequest extends BaseModel {
  static get tableName() { return 'rma_requests'; }

  static get fillable() {
    return [
      'organization_id', 'rma_number', 'asset_id', 'vendor_id',
      'status', 'reason', 'description', 'shipped_at', 'received_at',
      'resolved_at', 'replacement_asset_id', 'created_by', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = RmaRequest;
