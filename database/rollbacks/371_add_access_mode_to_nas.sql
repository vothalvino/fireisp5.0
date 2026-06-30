-- =============================================================================
-- Rollback 371 — Remove access_mode column from nas
-- =============================================================================
-- MySQL does not support `DROP COLUMN IF EXISTS`; guard via INFORMATION_SCHEMA so
-- the rollback is idempotent and parses on MySQL 8.

DROP PROCEDURE IF EXISTS rollback_371_drop_access_mode_from_nas;
DELIMITER //
CREATE PROCEDURE rollback_371_drop_access_mode_from_nas()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'access_mode'
  ) THEN
    ALTER TABLE nas DROP COLUMN access_mode;
  END IF;
END //
DELIMITER ;
CALL rollback_371_drop_access_mode_from_nas();
DROP PROCEDURE IF EXISTS rollback_371_drop_access_mode_from_nas;
