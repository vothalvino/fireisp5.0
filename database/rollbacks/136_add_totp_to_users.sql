-- =============================================================================
-- FireISP 5.0 — Rollback 136: Remove TOTP columns from users
-- =============================================================================
-- Reverses migration 136.  Drops totp_backup_codes, totp_enabled, totp_secret
-- from the users table.
-- WARNING: This destroys all 2FA configuration for every user.
--
-- MySQL 8 does not support DROP COLUMN IF EXISTS, so each drop is guarded by
-- an INFORMATION_SCHEMA check inside a stored procedure.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_136_drop_totp_columns;
DELIMITER //
CREATE PROCEDURE rollback_136_drop_totp_columns()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'totp_backup_codes'
  ) THEN
    ALTER TABLE users DROP COLUMN totp_backup_codes;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'totp_enabled'
  ) THEN
    ALTER TABLE users DROP COLUMN totp_enabled;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'totp_secret'
  ) THEN
    ALTER TABLE users DROP COLUMN totp_secret;
  END IF;
END //
DELIMITER ;
CALL rollback_136_drop_totp_columns();
DROP PROCEDURE IF EXISTS rollback_136_drop_totp_columns;
