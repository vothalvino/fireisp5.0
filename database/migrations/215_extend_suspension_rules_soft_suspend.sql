-- =============================================================================
-- Migration 215: Extend suspension_rules — soft_suspend action + speed columns
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend suspension_rules.action ENUM to add 'soft_suspend'
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_215_extend_suspension_action;
DELIMITER //
CREATE PROCEDURE migration_215_extend_suspension_action()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suspension_rules'
      AND COLUMN_NAME = 'action'
      AND COLUMN_TYPE LIKE '%soft_suspend%'
  ) THEN
    ALTER TABLE suspension_rules
      MODIFY COLUMN action
        ENUM('auto_suspend','notify_only','auto_disconnect','soft_suspend')
        NOT NULL COMMENT 'Action to perform when rule fires';
  END IF;
END //
DELIMITER ;
CALL migration_215_extend_suspension_action();
DROP PROCEDURE IF EXISTS migration_215_extend_suspension_action;

-- ---------------------------------------------------------------------------
-- 2. Add soft_suspend_download_kbps and soft_suspend_upload_kbps columns
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_215_add_soft_suspend_speed_cols;
DELIMITER //
CREATE PROCEDURE migration_215_add_soft_suspend_speed_cols()
BEGIN
  -- soft_suspend_download_kbps
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suspension_rules'
      AND COLUMN_NAME = 'soft_suspend_download_kbps'
  ) THEN
    ALTER TABLE suspension_rules
      ADD COLUMN soft_suspend_download_kbps INT UNSIGNED NULL DEFAULT 128
        COMMENT 'Throttled download speed (kbps) applied during soft suspension; NULL = inherit plan default' AFTER action;
  END IF;

  -- soft_suspend_upload_kbps
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suspension_rules'
      AND COLUMN_NAME = 'soft_suspend_upload_kbps'
  ) THEN
    ALTER TABLE suspension_rules
      ADD COLUMN soft_suspend_upload_kbps INT UNSIGNED NULL DEFAULT 128
        COMMENT 'Throttled upload speed (kbps) applied during soft suspension; NULL = inherit plan default' AFTER soft_suspend_download_kbps;
  END IF;
END //
DELIMITER ;
CALL migration_215_add_soft_suspend_speed_cols();
DROP PROCEDURE IF EXISTS migration_215_add_soft_suspend_speed_cols;
