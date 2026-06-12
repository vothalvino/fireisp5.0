-- =============================================================================
-- Migration 312: Seed generate_scheduled_reports scheduled task — §15.5
-- =============================================================================

INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, is_enabled)
SELECT NULL, 'generate_scheduled_reports', 'other',
    'Generate and email scheduled reports to configured recipients',
    '0 * * * *', 'normal', TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks WHERE task_name = 'generate_scheduled_reports'
);
