-- =============================================================================
-- Migration 369 — Add currency column to organizations
-- =============================================================================
-- Adds a single ISO 4217 currency code per organization so all money UI/
-- defaults can read from one authoritative source instead of per-plan pickers
-- or hardcoded constants.
--
-- Default 'MXN' matches FireISP's primary deployment market (Mexico).
-- MySQL 8 does not support ADD COLUMN IF NOT EXISTS, so the add is guarded by
-- an INFORMATION_SCHEMA check inside a stored procedure.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_369_org_currency;
DELIMITER //
CREATE PROCEDURE migration_369_org_currency()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE organizations
      ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'MXN'
        COMMENT 'ISO 4217 — the single currency for this org'
        AFTER country;
  END IF;
END //
DELIMITER ;
CALL migration_369_org_currency();
DROP PROCEDURE IF EXISTS migration_369_org_currency;
