-- =============================================================================
-- Migration 138 — Seed alert evaluation scheduled task
-- =============================================================================
-- Adds a system-level scheduled task that runs alert rule evaluation every 5 min.
-- =============================================================================

INSERT IGNORE INTO scheduled_tasks
  (task_name, cron_expression, description, is_enabled, priority, organization_id)
VALUES
  ('alert_evaluation', '*/5 * * * *', 'Evaluate monitoring alert rules against current SNMP metrics', TRUE, 5, NULL);
