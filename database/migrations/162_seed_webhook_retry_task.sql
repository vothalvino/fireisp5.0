-- =============================================================================
-- Migration 162: Seed webhook_retry scheduled task
-- =============================================================================
-- Seeds a dedicated background task that processes due webhook retry deliveries
-- every 5 minutes using exponential backoff.
--
-- A delivery row moves through these states:
--   pending  → (first attempt)
--   success  — delivered on first try
--   retrying — first try failed; next_retry_at set to NOW() + backoff(n)
--   dead_letter — max_retries exhausted; available for manual re-delivery via
--                 POST /api/v1/webhooks/deliveries/:id/redeliver
--
-- Backoff schedule (base 10 s, cap 1 h, full jitter):
--   Attempt 1 → 0–10 s   (first try; happens inline in dispatch())
--   Attempt 2 → 0–10 s
--   Attempt 3 → 0–20 s
--   Attempt 4 → 0–40 s
--   Attempt 5 → 0–80 s
--   Attempt 6 → 0–160 s
--   Attempt n → 0–min(3600, 10*2^(n-1)) s
--
-- Idempotency note: uses INSERT ... SELECT ... WHERE NOT EXISTS because the
-- UNIQUE KEY on (organization_id, task_name) never collides when
-- organization_id is NULL, so INSERT IGNORE would duplicate the row on re-run.
--
-- task_type is 'other' — the previous value 'webhook_retry' is not part of
-- the task_type ENUM (see migration 047) and was silently stored as '' by
-- INSERT IGNORE; 'other' is the closest existing ENUM member.
-- =============================================================================

INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'webhook_retry',
    'other',
    'Process due webhook retry deliveries — picks up retrying rows whose next_retry_at <= NOW(), makes one HTTP attempt per row, reschedules or dead-letters based on attempt count.',
    '*/5 * * * *',
    'normal',
    1,
    120,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'webhook_retry' AND organization_id IS NULL
);
