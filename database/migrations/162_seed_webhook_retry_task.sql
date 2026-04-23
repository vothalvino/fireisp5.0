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
-- Uses INSERT IGNORE for idempotency (UNIQUE KEY on organization_id+task_name).
-- =============================================================================

INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'webhook_retry',
     'webhook_retry',
     'Process due webhook retry deliveries — picks up retrying rows whose next_retry_at <= NOW(), makes one HTTP attempt per row, reschedules or dead-letters based on attempt count.',
     '*/5 * * * *',
     'normal',
     1,
     120,
     TRUE);
