-- =============================================================================
-- Migration 322: §16 Scheduled task seed — data_retention_compliance_check
-- =============================================================================

INSERT INTO scheduled_tasks (task_name, task_type, cron_expression, description, is_enabled)
SELECT 'data_retention_compliance_check', 'other', '0 3 * * *',
       'Daily check for overdue DSAR requests and stale government data requests past retention (§16.9)', 1
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'data_retention_compliance_check'
);
