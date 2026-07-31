// =============================================================================
// FireISP 5.0 — Outage Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Outage extends BaseModel {
  static get tableName() { return 'outages'; }

  static get fillable() {
    return [
      // organization_id is fillable so crudController can inject it on create
      // and so the route can ADOPT an unattributed legacy row. It is never
      // accepted from a request body — the route rejects that explicitly,
      // because validate() ignores undeclared fields rather than stripping
      // them, and a PUT could otherwise move an outage between tenants.
      'organization_id',
      'site_id', 'device_id', 'outage_type', 'title', 'description',
      'severity', 'started_at', 'resolved_at', 'affected_clients_count',
      'root_cause', 'status', 'created_by',
    ];
  }

  // Migration 437 added organization_id. TRUE gives every WRITE verb a strict
  // org predicate for free — before this, update/delete/restore ran with no
  // predicate at all and one tenant could resolve or delete another tenant's
  // outage.
  //
  // Legacy rows with a NULL org are still READABLE: that is done in the route
  // with an explicit `organization_id = ? OR organization_id IS NULL`, which
  // BaseModel cannot express. Reads admit unattributed rows; writes adopt them.
  static get hasOrgScope() { return true; }

  // The outages table has a deleted_at column (migration 151).
  static get softDelete() { return true; }
}

module.exports = Outage;
