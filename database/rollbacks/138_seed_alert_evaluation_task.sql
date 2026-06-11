-- =============================================================================
-- FireISP 5.0 — Rollback 138: Remove alert_evaluation scheduled task
-- =============================================================================
-- Reverses migration 138.
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name = 'alert_evaluation'
  AND organization_id IS NULL;
