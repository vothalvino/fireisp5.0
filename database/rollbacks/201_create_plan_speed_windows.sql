-- Rollback 201: Drop plan_speed_windows table and remove its scheduled task
DROP TABLE IF EXISTS plan_speed_windows;

-- Remove the scheduled task seeded by migration 201 (global row only)
DELETE FROM scheduled_tasks
WHERE task_name = 'apply_speed_windows'
  AND organization_id IS NULL;
