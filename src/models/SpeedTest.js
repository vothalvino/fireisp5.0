// =============================================================================
// FireISP 5.0 — SpeedTest Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SpeedTest extends BaseModel {
  static get tableName() { return 'speed_tests'; }

  static get fillable() {
    return [
      'client_id', 'contract_id', 'device_id',
      'test_source', 'server_location',
      'download_mbps', 'upload_mbps', 'latency_ms', 'jitter_ms',
      'packet_loss_pct', 'ip_address', 'notes', 'tested_at',
    ];
  }

  // speed_tests has no organization_id column (single-tenant deployment),
  // so org-scoping must stay off or BaseModel emits WHERE organization_id = ?
  // against a non-existent column → 500.
  static get hasOrgScope() { return false; }

  // deleted_at column added by migration 151 — soft-delete is supported.
  static get softDelete() { return true; }
}

module.exports = SpeedTest;
