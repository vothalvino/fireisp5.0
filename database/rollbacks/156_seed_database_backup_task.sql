-- Rollback: 156_seed_database_backup_task
-- Removes the database_backup scheduled task seed row.

DELETE FROM scheduled_tasks
WHERE task_name = 'database_backup'
  AND organization_id IS NULL;
