-- =============================================================================
-- Migration 304: Seed geofence_evaluation scheduled task — §13.2
-- =============================================================================
INSERT INTO scheduled_tasks (task_name, task_type, cron_expression, is_enabled, description)
SELECT 'geofence_evaluation', 'other', '*/10 * * * *', TRUE,
       'Evaluate all geofences — check device/CPE positions and emit alerts for violations'
FROM DUAL WHERE NOT EXISTS (
  SELECT 1 FROM scheduled_tasks WHERE task_name = 'geofence_evaluation'
);
