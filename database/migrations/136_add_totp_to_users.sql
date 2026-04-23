-- =============================================================================
-- Migration 136 — Add 2FA / TOTP columns to users
-- =============================================================================
-- Adds TOTP secret storage, enabled flag, and backup codes to the users table.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_136_add_totp_to_users;
DELIMITER //
CREATE PROCEDURE migration_136_add_totp_to_users()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'totp_secret'
  ) THEN
    ALTER TABLE users
      ADD COLUMN totp_secret VARCHAR(255) NULL AFTER status,
      ADD COLUMN totp_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER totp_secret,
      ADD COLUMN totp_backup_codes JSON NULL AFTER totp_enabled;
  END IF;
END //
DELIMITER ;
CALL migration_136_add_totp_to_users();
DROP PROCEDURE IF EXISTS migration_136_add_totp_to_users;
