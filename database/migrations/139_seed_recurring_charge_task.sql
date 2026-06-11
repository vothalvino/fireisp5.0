-- =============================================================================
-- Migration 139 — Seed recurring charge scheduled task
-- =============================================================================
-- Adds a system-level scheduled task for processing recurring payment charges.
--
-- Idempotency note: uses INSERT ... SELECT ... WHERE NOT EXISTS because the
-- UNIQUE KEY on (organization_id, task_name) never collides when
-- organization_id is NULL, so INSERT IGNORE would duplicate the row on re-run.
-- priority is the ENUM('low','normal','high','critical') — the original
-- numeric literal 4 mapped to 'critical' by ENUM index, which was not the
-- intent; the intended value is 'high'.
-- =============================================================================

INSERT INTO scheduled_tasks
  (task_name, cron_expression, description, is_enabled, priority, organization_id)
SELECT 'process_recurring_charges', '0 7 * * *', 'Auto-charge active recurring payment profiles with pending invoices', TRUE, 'high', NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'process_recurring_charges' AND organization_id IS NULL
);
