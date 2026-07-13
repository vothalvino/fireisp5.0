-- =============================================================================
-- Rollback 382 — Password reset + email verification columns on `users`
-- =============================================================================
-- Drops the two lookup indexes and four columns added by migration 382.
-- INFORMATION_SCHEMA-guarded so a re-run, or a rollback of a partially applied
-- 382, completes instead of aborting on the first already-reverted object.
-- No data restoration is attempted: these columns only ever held in-flight
-- reset/verification tokens (single-use, short-lived) and an informational
-- verification timestamp that nothing gates on — dropping them is lossless
-- from the product's point of view (any pending reset/verify link simply
-- becomes unredeemable, same as if it had expired).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_382_add_password_reset_email_verify_columns;
DELIMITER //
CREATE PROCEDURE rollback_382_add_password_reset_email_verify_columns()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME    = 'users'
      AND INDEX_NAME    = 'idx_users_reset_token_hash'
  ) THEN
    ALTER TABLE users DROP INDEX idx_users_reset_token_hash;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME    = 'users'
      AND INDEX_NAME    = 'idx_users_email_verify_token_hash'
  ) THEN
    ALTER TABLE users DROP INDEX idx_users_email_verify_token_hash;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'email_verified_at'
  ) THEN
    ALTER TABLE users DROP COLUMN email_verified_at;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'email_verify_token_hash'
  ) THEN
    ALTER TABLE users DROP COLUMN email_verify_token_hash;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'reset_token_expires'
  ) THEN
    ALTER TABLE users DROP COLUMN reset_token_expires;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'users'
      AND COLUMN_NAME  = 'reset_token_hash'
  ) THEN
    ALTER TABLE users DROP COLUMN reset_token_hash;
  END IF;
END //
DELIMITER ;
CALL rollback_382_add_password_reset_email_verify_columns();
DROP PROCEDURE IF EXISTS rollback_382_add_password_reset_email_verify_columns;
