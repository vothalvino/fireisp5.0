-- =============================================================================
-- Migration 138 — Seed alert evaluation scheduled task
-- =============================================================================
-- Adds a system-level scheduled task that runs alert rule evaluation every 5 min.
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
SELECT 'alert_evaluation', '*/5 * * * *', 'Evaluate monitoring alert rules against current SNMP metrics', TRUE, 'high', NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'alert_evaluation' AND organization_id IS NULL
);
