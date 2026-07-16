-- =============================================================================
-- FireISP 5.0 — Rollback 400: Remove maintenance_window_expiry scheduled task
-- =============================================================================
-- Reverses migration 400.
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name = 'maintenance_window_expiry'
  AND organization_id IS NULL;
