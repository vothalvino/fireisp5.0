-- =============================================================================
-- Migration 140: Add brute-force lockout columns to users table
-- =============================================================================
-- Adds failed_login_attempts and locked_until columns to support account
-- lockout after repeated failed login attempts.
-- Column additions are guarded with INFORMATION_SCHEMA checks so the
-- migration is safely re-runnable after a partial failure.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_140_add_login_lockout_columns;
DELIMITER //
CREATE PROCEDURE migration_140_add_login_lockout_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'failed_login_attempts'
  ) THEN
    ALTER TABLE users
      ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Consecutive failed login attempts since last successful login';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'locked_until'
  ) THEN
    ALTER TABLE users
      ADD COLUMN locked_until TIMESTAMP NULL DEFAULT NULL
        COMMENT 'Account locked until this timestamp; NULL = not locked';
  END IF;
END //
DELIMITER ;
CALL migration_140_add_login_lockout_columns();
DROP PROCEDURE IF EXISTS migration_140_add_login_lockout_columns;
