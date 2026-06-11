-- =============================================================================
-- FireISP 5.0 — Rollback 162: Remove webhook_retry scheduled task
-- =============================================================================
-- Reverses migration 162.  Deletes only the global seed row (organization_id
-- IS NULL) so tenant-created tasks of the same name are preserved.
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name = 'webhook_retry'
  AND organization_id IS NULL;
