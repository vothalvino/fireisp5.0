-- Migration: 160_add_portal_credentials_to_clients
-- Description: Adds portal_password_hash and portal_login_attempts /
--              portal_locked_until to clients so they can authenticate
--              against the self-service portal independently of staff accounts.
--              Column additions are guarded with INFORMATION_SCHEMA checks so
--              the migration is safely re-runnable after a partial failure.

DROP PROCEDURE IF EXISTS migration_160_add_portal_credentials;
DELIMITER //
CREATE PROCEDURE migration_160_add_portal_credentials()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_password_hash'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN portal_password_hash       VARCHAR(255) NULL      COMMENT 'bcrypt hash for self-service portal password; NULL = portal access not enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_login_attempts'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN portal_login_attempts      TINYINT      NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_locked_until'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN portal_locked_until        TIMESTAMP    NULL;
  END IF;
END //
DELIMITER ;
CALL migration_160_add_portal_credentials();
DROP PROCEDURE IF EXISTS migration_160_add_portal_credentials;
