-- =============================================================================
-- Rollback 258: §6.4 Polling Engine — remove tables and scheduled tasks
-- =============================================================================

-- Remove seeded scheduled tasks
DELETE FROM scheduled_tasks
WHERE task_name IN ('snmp_adaptive_poll_check', 'poller_performance_snapshot')
  AND organization_id IS NULL;

-- Drop tables in reverse FK dependency order
DROP TABLE IF EXISTS poller_performance_snapshots;
DROP TABLE IF EXISTS device_polling_configs;
DROP TABLE IF EXISTS poller_nodes;

-- END OF ROLLBACK 258
