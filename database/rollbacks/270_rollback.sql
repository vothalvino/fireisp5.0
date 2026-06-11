-- =============================================================================
-- Rollback 270: Remove PON port management extensions (§7.3)
-- =============================================================================
-- Drops onu_migration_jobs table, then removes columns added to olt_ports.
-- Guarded for idempotency.
-- =============================================================================

-- Drop table first (no dependents)
DROP TABLE IF EXISTS onu_migration_jobs;

-- Remove columns from olt_ports (guarded)
DROP PROCEDURE IF EXISTS rollback_270_strip_olt_ports;

DELIMITER $$
CREATE PROCEDURE rollback_270_strip_olt_ports()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'olt_ports'
      AND COLUMN_NAME  = 'maintenance_mode'
  ) THEN
    ALTER TABLE olt_ports
      DROP COLUMN maintenance_mode,
      DROP COLUMN maintenance_note,
      DROP COLUMN maintenance_by,
      DROP COLUMN maintenance_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'olt_ports'
      AND COLUMN_NAME  = 'xgspon_mode'
  ) THEN
    ALTER TABLE olt_ports
      DROP COLUMN xgspon_mode,
      DROP COLUMN xgspon_mode_validated;
  END IF;
END$$
DELIMITER ;

CALL rollback_270_strip_olt_ports();
DROP PROCEDURE IF EXISTS rollback_270_strip_olt_ports;
