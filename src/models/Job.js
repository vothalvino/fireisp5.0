// =============================================================================
// FireISP 5.0 — Job Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Job extends BaseModel {
  static get tableName() { return 'jobs'; }

  static get fillable() {
    return [
      'client_id', 'site_id', 'contract_id', 'ticket_id', 'assigned_to',
      'title', 'description', 'type', 'scheduled_date', 'completed_date',
      'priority', 'status', 'notes', 'created_by',
    ];
  }

  // The jobs table has no organization_id column (single-tenant per ISP),
  // so org scoping is disabled to avoid querying a non-existent column.
  static get hasOrgScope() { return false; }
}

module.exports = Job;
