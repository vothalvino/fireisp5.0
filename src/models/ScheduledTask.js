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

  // TRUE, even though the table also holds NULL-org GLOBAL rows.
  //
  // #582 left this false and fixed only the read path, which had two
  // consequences neither the PR nor its review caught:
  //   1. crudController injects organization_id on create ONLY when this is
  //      true — so every task a tenant created was written NULL-org, i.e.
  //      GLOBAL, and the creator was then 403'd out of editing their own task.
  //   2. update/delete/restore went through BaseModel with NO org predicate,
  //      so one tenant could edit or delete another tenant's task. The
  //      blockGlobalTaskWrites guard did not catch it: a row owned by another
  //      org is not global, so the guard waved it straight through.
  //
  // The NULL-org rows are still readable — that is done in the ROUTE with an
  // explicit `organization_id = ? OR organization_id IS NULL`, which BaseModel
  // cannot express. Reads admit globals; writes are strictly scoped here.
  static get hasOrgScope() { return true; }
}

module.exports = ScheduledTask;
