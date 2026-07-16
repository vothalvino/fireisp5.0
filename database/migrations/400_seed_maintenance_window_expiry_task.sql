-- =============================================================================
-- Migration 400 — Seed maintenance_window_expiry scheduled task
-- =============================================================================
-- Backs the fix for maintenance_windows never expiring out of 'active': the
-- alert-suppression predicate (alertService.activeMaintenanceWindowId /
-- GET /alerts/maintenance-windows/active) used to trust `status = 'active'`
-- without checking `ends_at`, and nothing ever flipped a window's status
-- automatically — the UI's Edit form lets any status be set freely, so a
-- window left at 'active' suppressed alerts forever.
--
-- This task runs alertService.expireMaintenanceWindows(), which completes any
-- window (status IN ('scheduled','active')) whose ends_at has passed. Seeded
-- org-wide (organization_id NULL, same as migration 138's alert_evaluation)
-- so it sweeps every organization in one run.
--
-- NOTE: this does NOT materialize recurring windows — recurrence_cron /
-- is_recurring remain captured-but-unimplemented (see alertService.js).
--
-- Idempotency note: same as migration 138 — INSERT ... SELECT ... WHERE NOT
-- EXISTS, because the UNIQUE KEY on (organization_id, task_name) never
-- collides when organization_id is NULL, so INSERT IGNORE would duplicate
-- the row on re-run.
-- =============================================================================

INSERT INTO scheduled_tasks
  (task_name, cron_expression, description, is_enabled, priority, organization_id)
SELECT 'maintenance_window_expiry', '*/15 * * * *', 'Complete maintenance windows whose end time has passed', TRUE, 'low', NULL
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'maintenance_window_expiry' AND organization_id IS NULL
);
