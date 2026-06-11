// =============================================================================
// FireISP 5.0 — CpeParameterMapping Model (§8.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeParameterMapping extends BaseModel {
  static get tableName() { return 'cpe_parameter_mappings'; }

  static get fillable() {
    return [
      'organization_id', 'cpe_profile_id', 'parameter_path',
      'source_type', 'source_field', 'static_value',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return false; }
}

module.exports = CpeParameterMapping;
