-- =============================================================================
-- FireISP 5.0 — Migration 158
-- =============================================================================
-- 1. Adds firerelay_node_id to devices so each device can be associated with
--    the FireRelay agent that can reach it over the RouterOS API.
-- 2. Seeds the config_backup_pull scheduled task (nightly at 02:00 UTC).
-- =============================================================================

-- Part 1 — add firerelay_node_id to devices
ALTER TABLE devices
  ADD COLUMN firerelay_node_id VARCHAR(64) NULL
    COMMENT 'FireRelay agent node that can reach this device via RouterOS API'
    AFTER notes,
  ADD KEY idx_devices_firerelay_node_id (firerelay_node_id);

-- Note: no FK is added because firerelay_nodes rows may not exist in all
-- deployments (standalone mode), and the agent connection is the authoritative
-- source of truth for whether a node is reachable.

-- Part 2 — seed the config_backup_pull scheduled task
INSERT IGNORE INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
VALUES
    (NULL,
     'config_backup_pull',
     'maintenance',
     'Nightly RouterOS config backup pull: for each device with a firerelay_node_id and ip_address, sends a config.backup command via the FireRelay tunnel and stores the result in device_config_backups. Skips unchanged configs (same SHA-256 checksum).',
     '0 2 * * *',   -- daily at 02:00 UTC
     'normal',
     2,
     3600,
     TRUE);
