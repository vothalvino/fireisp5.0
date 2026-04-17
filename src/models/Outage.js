// =============================================================================
// FireISP 5.0 — Outage Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Outage extends BaseModel {
  static get tableName() { return 'outages'; }

  static get fillable() {
    return [
      'organization_id', 'site_id', 'device_id', 'title', 'description',
      'severity', 'affected_clients', 'start_time', 'end_time',
      'root_cause', 'resolution', 'status',
    ];
  }

  static get hasOrgScope() { return true; }

  static get softDelete() { return true; }
}

module.exports = Outage;
