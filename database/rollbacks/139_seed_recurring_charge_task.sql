-- =============================================================================
-- FireISP 5.0 — Rollback 139: Remove process_recurring_charges scheduled task
-- =============================================================================
-- Reverses migration 139.
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name = 'process_recurring_charges'
  AND organization_id IS NULL;
