-- =============================================================================
-- Migration 145: Seed data retention scheduled task
-- =============================================================================
-- Runs daily at 03:00 to purge old records based on retention policies.
-- =============================================================================

INSERT INTO scheduled_tasks (task_name, cron_expression, description, is_enabled, priority)
VALUES ('data_retention', '0 3 * * *', 'Purge old audit logs, alert events, webhook deliveries, and expired idempotency keys', TRUE, 5)
ON DUPLICATE KEY UPDATE description = VALUES(description);
