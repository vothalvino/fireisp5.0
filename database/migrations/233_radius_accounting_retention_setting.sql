-- =============================================================================
-- Migration 233: RADIUS Accounting Retention & NAS Health Check Tasks (Phase C)
-- =============================================================================
-- Implements isp-platform-features.md §3.3 "RADIUS Accounting Phase C":
--   Seeds two global scheduled tasks required by the Phase C feature set.
--
-- Task 1: purge_radius_accounting
--   Deletes connection_logs rows older than RADIUS_ACCOUNTING_RETENTION_MONTHS
--   (environment variable, default 12 months). The retention period is
--   intentionally kept in env config rather than a DB setting so that
--   operations teams can adjust it without a schema migration.
--   Schedule: daily at 03:00 (low traffic window).
--
-- Task 2: nas_health_check
--   Probes each NAS via RADIUS Status-Server (code 12) and updates
--   nas.health_status + nas.last_health_check_at accordingly.
--   Emits nas.down / nas.up domain events when status changes.
--   Schedule: every 5 minutes.
--
-- Both tasks are global (organization_id = NULL) and use INSERT IGNORE so
-- re-running this migration on an already-migrated database is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed: purge_radius_accounting
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES
    (NULL,
     'purge_radius_accounting',
     'Delete connection_logs rows older than RADIUS_ACCOUNTING_RETENTION_MONTHS (default 12) months',
     '0 3 * * *',
     TRUE,
     'low');

-- ---------------------------------------------------------------------------
-- Seed: nas_health_check
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES
    (NULL,
     'nas_health_check',
     'Probe each NAS via RADIUS Status-Server (code 12) and update health_status; emit nas.down/nas.up events',
     '*/5 * * * *',
     TRUE,
     'normal');
