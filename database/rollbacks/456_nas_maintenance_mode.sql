-- =============================================================================
-- Rollback 456 — remove NAS maintenance mode
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_456_nas_maintenance_mode;
DELIMITER //
CREATE PROCEDURE rollback_456_nas_maintenance_mode()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'nas'
       AND COLUMN_NAME = 'maintenance_mode'
  ) THEN
    ALTER TABLE nas DROP COLUMN maintenance_mode;
  END IF;
END //
DELIMITER ;

CALL rollback_456_nas_maintenance_mode();
DROP PROCEDURE IF EXISTS rollback_456_nas_maintenance_mode;
