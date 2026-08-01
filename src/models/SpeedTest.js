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

  // organization_id added by migration 438. Scoping must stay ON: with it off
  // BaseModel omits the predicate SILENTLY, and every tenant could read and
  // rewrite every other tenant's SLA evidence.
  //
  // Reads that must also admit unattributed legacy rows are hand-written in
  // src/routes/speedTests.js — BaseModel cannot express `= ? OR IS NULL`.
  static get hasOrgScope() { return true; }

  // deleted_at column added by migration 151 — soft-delete is supported.
  static get softDelete() { return true; }
}

module.exports = SpeedTest;
