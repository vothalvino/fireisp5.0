-- Rollback: 360_add_routeros_api_fields_to_nas
-- Removes the RouterOS API connection columns added to nas in migration 360.

DROP PROCEDURE IF EXISTS rollback_360_remove_routeros_api_fields;
DELIMITER //
CREATE PROCEDURE rollback_360_remove_routeros_api_fields()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'nas'
      AND COLUMN_NAME  = 'api_port'
  ) THEN
    ALTER TABLE nas
      DROP COLUMN api_port,
      DROP COLUMN api_username,
      DROP COLUMN api_password_encrypted,
      DROP COLUMN api_use_tls;
  END IF;
END //
DELIMITER ;
CALL rollback_360_remove_routeros_api_fields();
DROP PROCEDURE IF EXISTS rollback_360_remove_routeros_api_fields;
