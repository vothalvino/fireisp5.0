// =============================================================================
// FireISP 5.0 — Outage Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Outage extends BaseModel {
  static get tableName() { return 'outages'; }

  static get fillable() {
    return [
      'site_id', 'device_id', 'outage_type', 'title', 'description',
      'severity', 'started_at', 'resolved_at', 'affected_clients_count',
      'root_cause', 'status', 'created_by',
    ];
  }

  // The outages table has no organization_id column (single-tenant per ISP).
  static get hasOrgScope() { return false; }

  // The outages table has a deleted_at column (migration 151).
  static get softDelete() { return true; }
}

module.exports = Outage;
