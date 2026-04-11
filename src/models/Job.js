// =============================================================================
// FireISP 5.0 — Job Model
// =============================================================================

const BaseModel = require('./BaseModel');

class Job extends BaseModel {
  static get tableName() { return 'jobs'; }

  static get fillable() {
    return [
      'organization_id', 'ticket_id', 'contract_id', 'assigned_to',
      'job_type', 'description', 'scheduled_at', 'completed_at',
      'priority', 'status', 'notes',
    ];
  }

  static get hasOrgScope() { return true; }
}

module.exports = Job;
