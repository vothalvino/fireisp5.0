// =============================================================================
// FireISP 5.0 — CpeParameter Model (§8.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeParameter extends BaseModel {
  static get tableName() { return 'cpe_parameters'; }

  static get fillable() {
    return [
      'cpe_device_id', 'organization_id', 'parameter_path',
      'parameter_value', 'is_writable', 'last_fetched_at',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return false; }
}

module.exports = CpeParameter;
