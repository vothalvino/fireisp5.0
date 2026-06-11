-- =============================================================================
-- Migration 145: Seed data retention scheduled task
-- =============================================================================
-- Runs daily at 03:00 to purge old records based on retention policies.
--
-- Idempotency note: uses INSERT ... SELECT ... WHERE NOT EXISTS because the
-- UNIQUE KEY on (organization_id, task_name) never collides when
-- organization_id is NULL, so the previous ON DUPLICATE KEY UPDATE clause
-- never fired for this global row and a re-run inserted a duplicate.
-- =============================================================================

INSERT INTO scheduled_tasks (organization_id, task_name, cron_expression, description, is_enabled, priority)
SELECT NULL, 'data_retention', '0 3 * * *', 'Purge old audit logs, alert events, webhook deliveries, and expired idempotency keys', TRUE, 'high'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'data_retention' AND organization_id IS NULL
);
