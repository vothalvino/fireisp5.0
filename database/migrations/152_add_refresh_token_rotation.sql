-- Migration: 152_add_refresh_token_rotation
-- Description: Add token_family column to user_sessions for refresh token
--              rotation with reuse detection. When a refresh token is reused
--              (already rotated), all sessions in the same family are revoked
--              to mitigate token theft.
--              Guarded with INFORMATION_SCHEMA checks so the migration is
--              safely re-runnable after a partial failure.

DROP PROCEDURE IF EXISTS migration_152_add_token_family;
DELIMITER //
CREATE PROCEDURE migration_152_add_token_family()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'user_sessions'
      AND COLUMN_NAME  = 'token_family'
  ) THEN
    ALTER TABLE user_sessions
        ADD COLUMN token_family VARCHAR(255) NULL AFTER token_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'user_sessions'
      AND INDEX_NAME   = 'idx_user_sessions_token_family'
  ) THEN
    ALTER TABLE user_sessions
        ADD KEY idx_user_sessions_token_family (token_family);
  END IF;
END //
DELIMITER ;
CALL migration_152_add_token_family();
DROP PROCEDURE IF EXISTS migration_152_add_token_family;
