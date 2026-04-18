// =============================================================================
// FireISP 5.0 — SpeedTest Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SpeedTest extends BaseModel {
  static get tableName() { return 'speed_tests'; }

  static get fillable() {
    return [
      'organization_id', 'client_id', 'contract_id', 'device_id',
      'download_mbps', 'upload_mbps', 'latency_ms', 'jitter_ms',
      'packet_loss_pct', 'source', 'ip_address', 'tested_at',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = SpeedTest;
