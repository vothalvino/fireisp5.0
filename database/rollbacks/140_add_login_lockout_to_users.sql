-- =============================================================================
-- FireISP 5.0 — Rollback 140: Remove brute-force lockout columns from users
-- =============================================================================
-- Reverses migration 140.  Drops locked_until and failed_login_attempts.
--
-- MySQL 8 does not support DROP COLUMN IF EXISTS, so each drop is guarded by
-- an INFORMATION_SCHEMA check inside a stored procedure.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_140_drop_lockout_columns;
DELIMITER //
CREATE PROCEDURE rollback_140_drop_lockout_columns()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'locked_until'
  ) THEN
    ALTER TABLE users DROP COLUMN locked_until;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'failed_login_attempts'
  ) THEN
    ALTER TABLE users DROP COLUMN failed_login_attempts;
  END IF;
END //
DELIMITER ;
CALL rollback_140_drop_lockout_columns();
DROP PROCEDURE IF EXISTS rollback_140_drop_lockout_columns;
