-- =============================================================================
-- Migration 139 — Seed recurring charge scheduled task
-- =============================================================================
-- Adds a system-level scheduled task for processing recurring payment charges.
-- =============================================================================

INSERT IGNORE INTO scheduled_tasks
  (task_name, cron_expression, description, is_enabled, priority, organization_id)
VALUES
  ('process_recurring_charges', '0 7 * * *', 'Auto-charge active recurring payment profiles with pending invoices', TRUE, 4, NULL);
