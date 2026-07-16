-- =============================================================================
-- Rollback 397 — Remove consecutive_poll_failures from devices
-- =============================================================================
-- MySQL does not support `DROP COLUMN IF EXISTS`; guard via INFORMATION_SCHEMA so
-- the rollback is idempotent and parses on MySQL 8.

DROP PROCEDURE IF EXISTS rollback_397_drop_consecutive_poll_failures;
DELIMITER //
CREATE PROCEDURE rollback_397_drop_consecutive_poll_failures()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'consecutive_poll_failures'
  ) THEN
    ALTER TABLE devices DROP COLUMN consecutive_poll_failures;
  END IF;
END //
DELIMITER ;
CALL rollback_397_drop_consecutive_poll_failures();
DROP PROCEDURE IF EXISTS rollback_397_drop_consecutive_poll_failures;
