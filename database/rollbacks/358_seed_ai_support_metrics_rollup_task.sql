-- Rollback for migration 358 — remove ai_support_metrics_rollup scheduled task
DELETE FROM scheduled_tasks WHERE task_name = 'ai_support_metrics_rollup';
