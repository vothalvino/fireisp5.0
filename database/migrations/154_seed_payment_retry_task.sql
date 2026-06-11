-- =============================================================================
-- Migration 154 — Seed payment retry scheduled task
-- =============================================================================
-- Adds a system-level scheduled task to process pending payment retries.
-- Runs every hour, checks for retries whose next_retry_at has passed.
--
-- Idempotency note: uses INSERT ... SELECT ... WHERE NOT EXISTS because the
-- UNIQUE KEY on (organization_id, task_name) never collides when
-- organization_id is NULL, so INSERT IGNORE would duplicate the row on re-run.
-- priority is the ENUM('low','normal','high','critical') — the original
-- numeric literal 5 was out of range and was silently stored as '' by
-- INSERT IGNORE; the intended value is 'high'.
-- =============================================================================

INSERT INTO scheduled_tasks
  (task_name, cron_expression, description, is_enabled, priority, organization_id)
SELECT 'retry_failed_charges', '0 * * * *', 'Retry failed payment charges (up to 3 attempts over 72 hours with exponential backoff)', TRUE, 'high', NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'retry_failed_charges' AND organization_id IS NULL
);
