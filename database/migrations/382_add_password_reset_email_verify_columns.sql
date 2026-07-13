-- =============================================================================
-- Migration 382 — Password reset + email verification columns on `users`
-- =============================================================================
-- src/services/authService.js's requestPasswordReset/resetPassword/verifyEmail/
-- generateEmailVerificationToken read and write four columns on `users` that
-- have never existed in the schema — every real call to
-- POST /auth/password-reset/request, POST /auth/password-reset, and
-- POST /auth/verify-email 500s with a MySQL "unknown column" error today.
--
-- Adds (placed after `locked_until`, before `created_at`):
--   reset_token_hash         — sha256 hex digest of the pending password-reset
--                               token; NULL when no reset is pending
--   reset_token_expires      — reset token expiry (NOW()+1hr on request)
--   email_verify_token_hash  — sha256 hex digest of the pending
--                               email-verification token
--   email_verified_at        — when the user confirmed their email; NULL =
--                               unverified. Informational only today — nothing
--                               gates login on it, so existing rows are left
--                               NULL (no backfill needed).
--
-- Plus two non-unique lookup indexes: both hashes are looked up by exact-match
-- WHERE clause (authService.js resetPassword/verifyEmail) with no existing
-- index; each value is a sha256 digest of 32 random bytes, so a non-unique
-- index is sufficient (collision-free in practice).
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8),
-- following the 380/374 stored-procedure pattern.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_382_add_password_reset_email_verify_columns;
DELIMITER //
CREATE PROCEDURE migration_382_add_password_reset_email_verify_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'reset_token_hash'
  ) THEN
    ALTER TABLE users
      ADD COLUMN reset_token_hash VARCHAR(64) NULL
          COMMENT 'sha256 hex digest of the password-reset token; NULL when no reset is pending (migration 382)'
          AFTER locked_until;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'reset_token_expires'
  ) THEN
    ALTER TABLE users
      ADD COLUMN reset_token_expires DATETIME NULL
          COMMENT 'Reset token expiry, set to NOW()+1hr on request (migration 382)'
          AFTER reset_token_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'email_verify_token_hash'
  ) THEN
    ALTER TABLE users
      ADD COLUMN email_verify_token_hash VARCHAR(64) NULL
          COMMENT 'sha256 hex digest of the pending email-verification token (migration 382)'
          AFTER reset_token_expires;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'email_verified_at'
  ) THEN
    ALTER TABLE users
      ADD COLUMN email_verified_at DATETIME NULL
          COMMENT 'When the user confirmed their email; NULL = unverified. Informational only today -- nothing gates login on it (migration 382)'
          AFTER email_verify_token_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME    = 'users'
      AND INDEX_NAME    = 'idx_users_reset_token_hash'
  ) THEN
    ALTER TABLE users ADD KEY idx_users_reset_token_hash (reset_token_hash);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME    = 'users'
      AND INDEX_NAME    = 'idx_users_email_verify_token_hash'
  ) THEN
    ALTER TABLE users ADD KEY idx_users_email_verify_token_hash (email_verify_token_hash);
  END IF;
END //
DELIMITER ;
CALL migration_382_add_password_reset_email_verify_columns();
DROP PROCEDURE IF EXISTS migration_382_add_password_reset_email_verify_columns;
