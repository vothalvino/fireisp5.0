-- =============================================================================
-- Migration 373: Seed the refresh_voip_ranges scheduled task
-- =============================================================================
-- Registers the weekly VoIP/RTC address-list auto-updater
-- (taskRunner.js → voipRangesService.refreshAllNas) as a scheduled_tasks row.
--
-- Seeded DISABLED (is_enabled = 0): pushing provider ranges to routers is opt-in,
-- to be enabled per deployment once real-time priority is seeded and VOIP_RANGES_ENABLED
-- is set. Global (organization_id = NULL). task_type 'maintenance', priority 'low'.
--
-- Idempotent via INSERT ... SELECT FROM DUAL WHERE NOT EXISTS (MySQL 8 valid; no
-- FROM DUAL syntax error, no INSERT IGNORE on NULL-org which never collides).
--
-- Requires: the scheduled_tasks table (migration 121/122 era).
-- =============================================================================

INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, handler, description,
     cron_expression, payload, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'refresh_voip_ranges',
    'maintenance',
    'voipRangesService.refreshAllNas',
    'Refreshes the fireisp-voip RTC/VoIP address-list on managed MikroTik NAS from provider IP-range sources. Disabled by default; enable once real-time priority is seeded and VOIP_RANGES_ENABLED=true.',
    '0 4 * * 1',
    NULL,
    'low',
    2,
    600,
    0
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks WHERE task_name = 'refresh_voip_ranges'
);

-- END OF MIGRATION 373
