-- =============================================================================
-- Migration 402: §6.4 Polling Engine activation — retime snmp_discovery_poll,
-- disable redundant duplicate full-fleet pollers
-- =============================================================================
-- taskRunner now routes snmp_discovery_poll through pollerEngine.pollWithConfig()
-- (interval-aware: per-device due-ness from device_polling_configs, adaptive
-- overrides during active outages). The row must tick every minute so
-- per-device intervals below 5 minutes — including adaptive_min_interval_sec
-- (default 60s) — can actually fire; pollWithConfig skips devices that are not
-- yet due, so devices without a config keep the default 300s cadence and the
-- effective load for an unconfigured fleet is unchanged.
--
-- No schema change: data-only UPDATEs on scheduled_tasks (idempotent).
-- =============================================================================

UPDATE scheduled_tasks
SET cron_expression = '*/1 * * * *',
    handler = 'pollerEngine.pollWithConfig'
WHERE task_name = 'snmp_discovery_poll'
  AND organization_id IS NULL;

-- ftth_olt_chassis_poll (migration 269) and wireless_ap_sector_poll
-- (migration 284) were both seeded as additional full-fleet generic polls —
-- every SNMP device, not just OLTs/APs (wireless_ap_sector_poll additionally
-- never had a taskRunner case at all). Alongside the poller above they would
-- only double-poll the whole fleet, so the rows are disabled. Their taskRunner
-- cases remain for manual runs.
UPDATE scheduled_tasks
SET is_enabled = 0
WHERE task_name IN ('ftth_olt_chassis_poll', 'wireless_ap_sector_poll')
  AND organization_id IS NULL;

-- END OF MIGRATION 402
