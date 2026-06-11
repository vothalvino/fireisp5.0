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
-- Both tasks are global (organization_id = NULL) and use one
-- INSERT ... SELECT ... WHERE NOT EXISTS per task so re-running this
-- migration on an already-migrated database is safe.  (The UNIQUE KEY on
-- (organization_id, task_name) never collides when organization_id is NULL,
-- so INSERT IGNORE would duplicate rows on re-run.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Seed: purge_radius_accounting
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'purge_radius_accounting',
    'Delete connection_logs rows older than RADIUS_ACCOUNTING_RETENTION_MONTHS (default 12) months',
    '0 3 * * *',
    TRUE,
    'low'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'purge_radius_accounting' AND organization_id IS NULL
);

-- ---------------------------------------------------------------------------
-- Seed: nas_health_check
-- ---------------------------------------------------------------------------
INSERT INTO scheduled_tasks
    (organization_id, task_name, description, cron_expression, is_enabled, priority)
SELECT
    NULL,
    'nas_health_check',
    'Probe each NAS via RADIUS Status-Server (code 12) and update health_status; emit nas.down/nas.up events',
    '*/5 * * * *',
    TRUE,
    'normal'
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'nas_health_check' AND organization_id IS NULL
);
