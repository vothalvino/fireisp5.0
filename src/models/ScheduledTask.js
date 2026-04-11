// =============================================================================
// FireISP 5.0 — ScheduledTask Model
// =============================================================================

const BaseModel = require('./BaseModel');

class ScheduledTask extends BaseModel {
  static get tableName() { return 'scheduled_tasks'; }

  static get fillable() {
    return [
      'organization_id', 'task_name', 'task_type', 'cron_expression',
      'payload', 'is_enabled', 'max_retries', 'retry_delay_seconds',
      'priority', 'last_run_at', 'next_run_at', 'status',
    ];
  }

  static get hasOrgScope() { return false; }
}

module.exports = ScheduledTask;
