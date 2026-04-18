-- =============================================================================
-- Migration 154 — Seed payment retry scheduled task
-- =============================================================================
-- Adds a system-level scheduled task to process pending payment retries.
-- Runs every hour, checks for retries whose next_retry_at has passed.
-- =============================================================================

INSERT IGNORE INTO scheduled_tasks
  (task_name, cron_expression, description, is_enabled, priority, organization_id)
VALUES
  ('retry_failed_charges', '0 * * * *', 'Retry failed payment charges (up to 3 attempts over 72 hours with exponential backoff)', TRUE, 5, NULL);
