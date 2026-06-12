-- Rollback 304
DELETE FROM scheduled_tasks WHERE task_name = 'geofence_evaluation';
