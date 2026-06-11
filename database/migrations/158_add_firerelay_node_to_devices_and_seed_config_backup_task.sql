-- =============================================================================
-- FireISP 5.0 — Migration 158
-- =============================================================================
-- 1. Adds firerelay_node_id to devices so each device can be associated with
--    the FireRelay agent that can reach it over the RouterOS API.
-- 2. Seeds the config_backup_pull scheduled task (nightly at 02:00 UTC).
-- =============================================================================

-- Part 1 — add firerelay_node_id to devices
-- Guarded with INFORMATION_SCHEMA checks so the migration is safely
-- re-runnable after a partial failure.
DROP PROCEDURE IF EXISTS migration_158_add_firerelay_node_id;
DELIMITER //
CREATE PROCEDURE migration_158_add_firerelay_node_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'firerelay_node_id'
  ) THEN
    ALTER TABLE devices
      ADD COLUMN firerelay_node_id VARCHAR(64) NULL
        COMMENT 'FireRelay agent node that can reach this device via RouterOS API'
        AFTER notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND INDEX_NAME   = 'idx_devices_firerelay_node_id'
  ) THEN
    ALTER TABLE devices
      ADD KEY idx_devices_firerelay_node_id (firerelay_node_id);
  END IF;
END //
DELIMITER ;
CALL migration_158_add_firerelay_node_id();
DROP PROCEDURE IF EXISTS migration_158_add_firerelay_node_id;

-- Note: no FK is added because firerelay_nodes rows may not exist in all
-- deployments (standalone mode), and the agent connection is the authoritative
-- source of truth for whether a node is reachable.

-- Part 2 — seed the config_backup_pull scheduled task
-- Idempotency note: uses INSERT ... SELECT ... WHERE NOT EXISTS because the
-- UNIQUE KEY on (organization_id, task_name) never collides when
-- organization_id is NULL, so INSERT IGNORE would duplicate the row on re-run.
-- task_type is 'backup' — the previous value 'maintenance' is not part of the
-- task_type ENUM (see migration 047) and was silently stored as '' by
-- INSERT IGNORE; 'backup' is the existing ENUM member matching this task.
INSERT INTO scheduled_tasks
    (organization_id, task_name, task_type, description,
     cron_expression, priority, max_retries, timeout_seconds, is_enabled)
SELECT
    NULL,
    'config_backup_pull',
    'backup',
    'Nightly RouterOS config backup pull: for each device with a firerelay_node_id and ip_address, sends a config.backup command via the FireRelay tunnel and stores the result in device_config_backups. Skips unchanged configs (same SHA-256 checksum).',
    '0 2 * * *',   -- daily at 02:00 UTC
    'normal',
    2,
    3600,
    TRUE
FROM DUAL
WHERE NOT EXISTS (
    SELECT 1 FROM scheduled_tasks
    WHERE task_name = 'config_backup_pull' AND organization_id IS NULL
);
