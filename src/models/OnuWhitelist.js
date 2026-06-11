// =============================================================================
// FireISP 5.0 — OnuWhitelist Model (§7.2)
// =============================================================================

const BaseModel = require('./BaseModel');

class OnuWhitelist extends BaseModel {
  static get tableName() { return 'onu_whitelist'; }

  static get fillable() {
    return [
      'organization_id', 'olt_device_id', 'entry_type', 'entry_value',
      'list_type', 'device_id', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static get sortable() {
    return ['id', 'entry_value', 'list_type', 'entry_type', 'created_at'];
  }
}

module.exports = OnuWhitelist;
