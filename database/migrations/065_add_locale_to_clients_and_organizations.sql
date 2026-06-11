-- Migration: 065_add_locale_to_clients_and_organizations
-- Description: Introduces a locale column to both clients and organizations as
--              the master switch for regional compliance.
--
--              locale = 'global' (default) — lightweight, no Mexico-specific
--              requirements enforced.  Works for any country.
--
--              locale = 'MX' — activates SAT CFDI 4.0 e-invoicing validation
--              and IFT/CRT telecom-compliance checks at the application layer.
--              The app will require a client_mx_profiles / organization_mx_profiles
--              row to exist before finalizing MX documents.
--
--              Backfill: clients that already have a CURP value (Mexican personal
--              clients) are automatically set to locale = 'MX'.
--
--              Column / key additions use stored-procedure IF NOT EXISTS guards
--              so the file is safe to re-run after a mid-file failure.

-- ---------------------------------------------------------------------------
-- clients: locale column + key
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_065_add_clients_locale;
DELIMITER //
CREATE PROCEDURE migration_065_add_clients_locale()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'locale'
  ) THEN
    ALTER TABLE clients
        ADD COLUMN locale ENUM('global', 'MX') NOT NULL DEFAULT 'global'
            COMMENT 'Regional compliance switch: global = no country-specific requirements; MX = SAT CFDI 4.0 + IFT/CRT compliance required'
            AFTER client_type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND INDEX_NAME   = 'idx_clients_locale'
  ) THEN
    ALTER TABLE clients
        ADD KEY idx_clients_locale (locale);
  END IF;
END //
DELIMITER ;
CALL migration_065_add_clients_locale();
DROP PROCEDURE IF EXISTS migration_065_add_clients_locale;

-- ---------------------------------------------------------------------------
-- organizations: locale column + key
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_065_add_organizations_locale;
DELIMITER //
CREATE PROCEDURE migration_065_add_organizations_locale()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND COLUMN_NAME  = 'locale'
  ) THEN
    ALTER TABLE organizations
        ADD COLUMN locale ENUM('global', 'MX') NOT NULL DEFAULT 'global'
            COMMENT 'Regional compliance switch: global = no country-specific requirements; MX = SAT CFDI 4.0 + IFT/CRT compliance required'
            AFTER name;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND INDEX_NAME   = 'idx_organizations_locale'
  ) THEN
    ALTER TABLE organizations
        ADD KEY idx_organizations_locale (locale);
  END IF;
END //
DELIMITER ;
CALL migration_065_add_organizations_locale();
DROP PROCEDURE IF EXISTS migration_065_add_organizations_locale;

-- Backfill: mark existing clients that have a CURP as Mexican
UPDATE clients SET locale = 'MX' WHERE curp IS NOT NULL;
