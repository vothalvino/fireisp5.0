// =============================================================================
// FireISP 5.0 — DataMaskingRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DataMaskingRule extends BaseModel {
  static get tableName() { return 'data_masking_rules'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'table_name', 'column_name', 'masking_type', 'mask_pattern', 'roles_exempt', 'is_active', 'notes'];
  }
}

module.exports = DataMaskingRule;
