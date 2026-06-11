// =============================================================================
// FireISP 5.0 — CpeLifecycleHistory Model (§8.4)
// =============================================================================

const BaseModel = require('./BaseModel');

class CpeLifecycleHistory extends BaseModel {
  static get tableName() { return 'cpe_lifecycle_history'; }

  static get fillable() {
    return [
      'organization_id', 'cpe_device_id', 'from_state', 'to_state',
      'reason', 'swap_in_device_id', 'swap_out_device_id', 'performed_by',
    ];
  }

  static get hasOrgScope() { return true; }
  static get softDelete() { return false; }
}

module.exports = CpeLifecycleHistory;
