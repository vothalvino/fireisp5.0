-- =============================================================================
-- Rollback 373: Remove the refresh_voip_ranges scheduled task
-- =============================================================================
DELETE FROM scheduled_tasks WHERE task_name = 'refresh_voip_ranges';
-- END OF ROLLBACK 373
