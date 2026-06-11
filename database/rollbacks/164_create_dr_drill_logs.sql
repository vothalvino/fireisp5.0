-- =============================================================================
-- FireISP 5.0 — Rollback 164: Drop dr_drill_logs table and remove the
--                             quarterly_dr_drill scheduled task
-- =============================================================================
-- Reverses migration 164.  Deletes only the global seed row (organization_id
-- IS NULL) so tenant-created tasks of the same name are preserved.
-- =============================================================================

DROP TABLE IF EXISTS dr_drill_logs;

DELETE FROM scheduled_tasks
WHERE task_name = 'quarterly_dr_drill'
  AND organization_id IS NULL;
