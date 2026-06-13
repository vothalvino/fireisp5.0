// =============================================================================
// FireISP 5.0 — DataMaskingRule Model
// =============================================================================

const BaseModel = require('./BaseModel');

class DataMaskingRule extends BaseModel {
  static get tableName() { return 'data_masking_rules'; }
  static get hasOrgScope() { return true; }
  static get fillable() {
    return ['organization_id', 'table_name', 'column_name', 'mask_type', 'mask_pattern', 'min_role_to_view_plain', 'is_active', 'notes', 'created_by'];
  }
}

module.exports = DataMaskingRule;
