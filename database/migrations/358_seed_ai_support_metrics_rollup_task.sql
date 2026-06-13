-- =============================================================================
-- Migration 358 — §21.6 AI Support Metrics: seed nightly rollup scheduled task
-- =============================================================================

INSERT INTO scheduled_tasks (task_name, task_type, description, cron_expression, is_enabled, priority, organization_id)
SELECT 'ai_support_metrics_rollup', 'other', 'Nightly rollup of AI support conversation metrics', '0 1 * * *', 1, 'normal', NULL
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM scheduled_tasks WHERE task_name = 'ai_support_metrics_rollup');
