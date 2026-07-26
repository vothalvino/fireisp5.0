-- Rollback 424 — remove the tls_expiry_monitor scheduled task.
-- Notifications it already created are left alone: they are a record of alerts
-- that genuinely fired, and deleting them would erase history.
DELETE FROM scheduled_tasks
 WHERE task_name = 'tls_expiry_monitor' AND organization_id IS NULL;
