-- =============================================================================
-- FireISP 5.0 — Rollback 189: Rename radius.password back to password_hash
-- =============================================================================
-- Reverses migration 189.  Mirrors the forward migration's guard: the rename
-- only runs when `password` currently exists and `password_hash` does not,
-- so re-running (or rolling back a never-applied rename) is a safe no-op.
-- The column values are untouched — only the name reverts.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_189_rename_radius_password;
DELIMITER //
CREATE PROCEDURE rollback_189_rename_radius_password()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'password'
  ) AND NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'password_hash'
  ) THEN
    ALTER TABLE radius
      CHANGE COLUMN password password_hash VARCHAR(255) NOT NULL;
  END IF;
END //
DELIMITER ;
CALL rollback_189_rename_radius_password();
DROP PROCEDURE IF EXISTS rollback_189_rename_radius_password;
