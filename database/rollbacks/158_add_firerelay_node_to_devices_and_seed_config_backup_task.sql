-- =============================================================================
-- FireISP 5.0 — Rollback 158: Remove devices.firerelay_node_id and the
--                             config_backup_pull scheduled task
-- =============================================================================
-- Reverses migration 158.  Drops the idx_devices_firerelay_node_id index and
-- the firerelay_node_id column from devices, and deletes the global
-- config_backup_pull seed row from scheduled_tasks.
--
-- Guarded on INFORMATION_SCHEMA (MySQL 8 has no DROP COLUMN / DROP INDEX
-- IF EXISTS).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_158_drop_firerelay_node_id;
DELIMITER //
CREATE PROCEDURE rollback_158_drop_firerelay_node_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND INDEX_NAME   = 'idx_devices_firerelay_node_id'
  ) THEN
    ALTER TABLE devices DROP INDEX idx_devices_firerelay_node_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'firerelay_node_id'
  ) THEN
    ALTER TABLE devices DROP COLUMN firerelay_node_id;
  END IF;
END //
DELIMITER ;
CALL rollback_158_drop_firerelay_node_id();
DROP PROCEDURE IF EXISTS rollback_158_drop_firerelay_node_id;

-- Remove the scheduled task seeded by migration 158 (global row only)
DELETE FROM scheduled_tasks
WHERE task_name = 'config_backup_pull'
  AND organization_id IS NULL;
