// =============================================================================
// FireISP 5.0 — SpeedTest Model
// =============================================================================

const BaseModel = require('./BaseModel');

class SpeedTest extends BaseModel {
  static get tableName() { return 'speed_tests'; }

  static get fillable() {
    return [
      // organization_id is fillable so crudController can inject it on create
      // and so the route can ADOPT an unattributed legacy row. It is never
      // accepted from a request body — the route rejects that explicitly,
      // because validate() ignores undeclared fields rather than stripping
      // them, and a PUT could otherwise move a record between tenants.
      //
      // Omitting it does NOT fail loudly: crudController sets
      // req.body.organization_id, BaseModel.create then filters strictly to
      // fillable and drops it, and the row is born NULL-org — unattributed,
      // and therefore visible to every tenant. That silently reopens the leak
      // migration 438 closed, for every new row.
      'organization_id',
      // work_order_id is intentionally NOT fillable. It is trusted
      // commissioning evidence written only by the dedicated work-order
      // commands; generic speed-test CRUD must never mint activation proof.
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
