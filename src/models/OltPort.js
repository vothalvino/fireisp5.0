// =============================================================================
// FireISP 5.0 — OltPort Model (§7.1)
// =============================================================================

const BaseModel = require('./BaseModel');

class OltPort extends BaseModel {
  static get tableName() { return 'olt_ports'; }

  static get fillable() {
    return [
      'organization_id', 'olt_device_id', 'port_index', 'port_name',
      'port_type', 'slot_no', 'port_no', 'admin_status', 'oper_status',
      'onu_count', 'max_onus', 'tx_power_dbm', 'rx_power_dbm',
      'bandwidth_up_bps', 'bandwidth_down_bps', 'last_polled_at', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }

  static get sortable() {
    return ['id', 'port_name', 'port_index', 'oper_status', 'onu_count', 'created_at'];
  }
}

module.exports = OltPort;
