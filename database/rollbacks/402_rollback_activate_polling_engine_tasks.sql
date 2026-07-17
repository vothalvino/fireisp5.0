-- =============================================================================
-- Rollback 402: restore snmp_discovery_poll to the 5-minute full poll and
-- re-enable the duplicate full-fleet poller rows
-- =============================================================================

UPDATE scheduled_tasks
SET cron_expression = '*/5 * * * *',
    handler = 'snmpPoller.poll'
WHERE task_name = 'snmp_discovery_poll'
  AND organization_id IS NULL;

UPDATE scheduled_tasks
SET is_enabled = 1
WHERE task_name IN ('ftth_olt_chassis_poll', 'wireless_ap_sector_poll')
  AND organization_id IS NULL;
