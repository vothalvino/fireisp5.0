-- =============================================================================
-- Migration 322: §16 Scheduled task seed — data_retention_compliance_check
-- =============================================================================

INSERT INTO scheduled_tasks (task_name, is_enabled)
SELECT 'data_retention_compliance_check', 1
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'data_retention_compliance_check'
);
