// =============================================================================
// FireISP 5.0 — QualityClass Model
// =============================================================================

const BaseModel = require('./BaseModel');

class QualityClass extends BaseModel {
  static get tableName() { return 'quality_classes'; }

  static get fillable() {
    return [
      'organization_id', 'name', 'description', 'traffic_type', 'priority',
      'dscp_mark', 'mikrotik_queue_kind', 'max_limit_pct', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = QualityClass;
