-- =============================================================================
-- Rollback 227: Drop walled garden settings + revert suspension_rules action ENUM
-- =============================================================================

DROP TABLE IF EXISTS organization_walled_garden_settings;

-- Revert action ENUM (remove walled_garden value)
DROP PROCEDURE IF EXISTS rollback_227_revert_suspension_action;
DELIMITER //
CREATE PROCEDURE rollback_227_revert_suspension_action()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME  = 'suspension_rules'
      AND COLUMN_NAME = 'action'
      AND COLUMN_TYPE LIKE '%walled_garden%'
  ) THEN
    -- Delete any rows using the walled_garden action before reverting
    DELETE FROM suspension_rules WHERE action = 'walled_garden';
    ALTER TABLE suspension_rules
      MODIFY COLUMN action
        ENUM('auto_suspend','notify_only','auto_disconnect','soft_suspend')
        NOT NULL COMMENT 'Action to perform when rule fires';
  END IF;
END //
DELIMITER ;
CALL rollback_227_revert_suspension_action();
DROP PROCEDURE IF EXISTS rollback_227_revert_suspension_action;
