-- =============================================================================
-- FireISP 5.0 — Rollback 155: Remove billing_cycle scheduled task
-- =============================================================================
-- Reverses migration 155.  Deletes only the global seed row (organization_id
-- IS NULL) so tenant-created tasks of the same name are preserved.
-- =============================================================================

DELETE FROM scheduled_tasks
WHERE task_name = 'billing_cycle'
  AND organization_id IS NULL;
