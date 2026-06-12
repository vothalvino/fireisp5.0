-- Rollback 293: Bandwidth test servers and speed test jobs
SET FOREIGN_KEY_CHECKS=0;
DELETE FROM scheduled_tasks WHERE task_name = 'subscriber_speed_test_run' AND organization_id IS NULL;
DROP TABLE IF EXISTS subscriber_speed_test_jobs;
DROP TABLE IF EXISTS bandwidth_test_servers;
SET FOREIGN_KEY_CHECKS=1;
