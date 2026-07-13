-- =============================================================================
-- Migration 385 — Portal password reset columns on `clients`
-- =============================================================================
-- The subscriber self-service portal (src/services/portalAuthService.js,
-- src/routes/portal.js) has no forgot-password flow: PUT /portal/auth/password
-- requires the CURRENT password, so a client who forgets their portal
-- password has no self-service recovery path today — only a staff member
-- manually resetting it via setPassword() works. This mirrors migration 382's
-- fix for the equivalent staff-side gap, but on `clients` (the table that
-- already holds portal_password_hash/portal_login_attempts/portal_locked_until
-- for subscriber auth — there is no separate `portal_users` table).
--
-- Adds (placed after `portal_locked_until`, before `version`):
--   portal_reset_token_hash     — sha256 hex digest of the pending portal
--                                  password-reset token; NULL when no reset
--                                  is pending
--   portal_reset_token_expires  — reset token expiry (NOW()+1hr on request)
--
-- Plus one non-unique lookup index: the hash is looked up by exact-match
-- WHERE clause with no existing index; each value is a sha256 digest of 32
-- random bytes, so a non-unique index is sufficient (collision-free in
-- practice) — identical reasoning to migration 382's reset_token_hash index.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8),
-- following the 382/380/374 stored-procedure pattern.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_385_add_portal_password_reset_columns;
DELIMITER //
CREATE PROCEDURE migration_385_add_portal_password_reset_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_reset_token_hash'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN portal_reset_token_hash VARCHAR(64) NULL
          COMMENT 'sha256 hex digest of the pending portal password-reset token; NULL when no reset is pending (migration 385)'
          AFTER portal_locked_until;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_reset_token_expires'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN portal_reset_token_expires DATETIME NULL
          COMMENT 'Portal reset token expiry, set to NOW()+1hr on request (migration 385)'
          AFTER portal_reset_token_hash;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME    = 'clients'
      AND INDEX_NAME    = 'idx_clients_portal_reset_token_hash'
  ) THEN
    ALTER TABLE clients ADD KEY idx_clients_portal_reset_token_hash (portal_reset_token_hash);
  END IF;
END //
DELIMITER ;
CALL migration_385_add_portal_password_reset_columns();
DROP PROCEDURE IF EXISTS migration_385_add_portal_password_reset_columns;
