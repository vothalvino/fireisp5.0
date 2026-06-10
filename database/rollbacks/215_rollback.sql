-- Rollback 215: Remove soft_suspend speed columns from suspension_rules
-- NOTE: The ENUM extension (adding 'soft_suspend') is not reversible via ALTER COLUMN
-- if any rows already hold that value. The MODIFY below restores the original three
-- values — run only after confirming no rows use 'soft_suspend'.

DROP PROCEDURE IF EXISTS rollback_215_remove_soft_suspend_cols;
DELIMITER //
CREATE PROCEDURE rollback_215_remove_soft_suspend_cols()
BEGIN
  -- Drop soft_suspend_upload_kbps
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suspension_rules'
      AND COLUMN_NAME = 'soft_suspend_upload_kbps'
  ) THEN
    ALTER TABLE suspension_rules DROP COLUMN soft_suspend_upload_kbps;
  END IF;

  -- Drop soft_suspend_download_kbps
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suspension_rules'
      AND COLUMN_NAME = 'soft_suspend_download_kbps'
  ) THEN
    ALTER TABLE suspension_rules DROP COLUMN soft_suspend_download_kbps;
  END IF;

  -- Restore original ENUM (only safe if no rows have action = 'soft_suspend')
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suspension_rules'
      AND COLUMN_NAME = 'action'
      AND COLUMN_TYPE LIKE '%soft_suspend%'
  ) THEN
    ALTER TABLE suspension_rules
      MODIFY COLUMN action
        ENUM('auto_suspend','notify_only','auto_disconnect')
        NOT NULL COMMENT 'Action to perform when rule fires';
  END IF;
END //
DELIMITER ;
CALL rollback_215_remove_soft_suspend_cols();
DROP PROCEDURE IF EXISTS rollback_215_remove_soft_suspend_cols;
