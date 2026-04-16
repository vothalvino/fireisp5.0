-- =============================================================================
-- FireISP 5.0 — Rollback 145: Remove data_retention scheduled task
-- =============================================================================
-- Reverses migration 145.
-- =============================================================================

DELETE FROM scheduled_tasks WHERE task_name = 'data_retention';
