-- =============================================================================
-- FireISP 5.0 — Rollback 160: Remove portal credential columns from clients
-- =============================================================================
-- Reverses migration 160.  Drops portal_locked_until, portal_login_attempts,
-- and portal_password_hash from clients.
-- WARNING: This destroys all self-service portal passwords.
--
-- Guarded on INFORMATION_SCHEMA (MySQL 8 has no DROP COLUMN IF EXISTS).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_160_drop_portal_credentials;
DELIMITER //
CREATE PROCEDURE rollback_160_drop_portal_credentials()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_locked_until'
  ) THEN
    ALTER TABLE clients DROP COLUMN portal_locked_until;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_login_attempts'
  ) THEN
    ALTER TABLE clients DROP COLUMN portal_login_attempts;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_password_hash'
  ) THEN
    ALTER TABLE clients DROP COLUMN portal_password_hash;
  END IF;
END //
DELIMITER ;
CALL rollback_160_drop_portal_credentials();
DROP PROCEDURE IF EXISTS rollback_160_drop_portal_credentials;
