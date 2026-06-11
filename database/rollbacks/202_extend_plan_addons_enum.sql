-- Rollback 202: Restore plan_addons.addon_type to original ENUM

DROP PROCEDURE IF EXISTS rollback_202_extend_addon_type;
DELIMITER //
CREATE PROCEDURE rollback_202_extend_addon_type()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'plan_addons'
      AND COLUMN_NAME = 'addon_type'
      AND COLUMN_TYPE LIKE '%voip%'
  ) THEN
    ALTER TABLE plan_addons
      MODIFY COLUMN addon_type
        ENUM('static_ip','extra_ip_block','extra_bandwidth','equipment_rental','other')
        NOT NULL COMMENT 'Category of add-on for reporting and processing logic';
  END IF;
END //
DELIMITER ;
CALL rollback_202_extend_addon_type();
DROP PROCEDURE IF EXISTS rollback_202_extend_addon_type;
