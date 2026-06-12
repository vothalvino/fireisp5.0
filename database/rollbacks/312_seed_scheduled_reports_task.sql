-- =============================================================================
-- Rollback 312: Remove generate_scheduled_reports task
-- =============================================================================

DELETE FROM scheduled_tasks WHERE task_name = 'generate_scheduled_reports';
