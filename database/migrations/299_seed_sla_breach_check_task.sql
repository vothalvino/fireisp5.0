-- =============================================================================
-- Migration 299: Seed SLA breach check scheduled task — §12
-- =============================================================================
INSERT INTO scheduled_tasks (task_name, task_type, cron_expression, is_enabled, description)
SELECT 'sla_breach_check', 'notification', '*/5 * * * *', TRUE,
       'Check for SLA breaches on open tickets and fire escalation events'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'sla_breach_check'
);
