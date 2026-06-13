// =============================================================================
// FireISP 5.0 — BatchJob Model (§18.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class BatchJob extends BaseModel {
  static get tableName() { return 'batch_jobs'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'operation', 'filter_criteria',
      'operation_params', 'status', 'total_items', 'processed_items',
      'success_items', 'failed_items', 'started_at', 'completed_at',
      'created_by',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = BatchJob;
