-- =============================================================================
-- Migration 410 — pac_providers.seal_mode: who seals the CFDI XML
-- =============================================================================
-- 'pac'   = the PAC seals with the CSD registered in ITS vault (SW "Emisión",
--           Facturama-style) — the pre-410 behavior, kept as the default.
-- 'local' = FireISP seals with the organization's ACTIVE csd_certificates row
--           (cfdiSealService, engine sandbox-proven byte-compatible) and sends
--           the SEALED XML to the PAC's stamp-only tier (SW "Timbrado",
--           /cfdi33/stamp/v4 multipart — probe-verified). The CSD private key
--           never leaves the server, and stamp-only tiers price cheaper.
--
-- Guarded via INFORMATION_SCHEMA (idempotent), mirrors migration 409's shape.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_410_pac_seal_mode;
DELIMITER //
CREATE PROCEDURE migration_410_pac_seal_mode()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'pac_providers'
      AND COLUMN_NAME = 'seal_mode'
  ) THEN
    ALTER TABLE pac_providers
      ADD COLUMN seal_mode ENUM('pac', 'local') NOT NULL DEFAULT 'pac'
        COMMENT 'pac = provider seals with vaulted CSD (Emisión); local = FireISP seals with the org''s active CSD and sends sealed XML to the stamp-only tier'
        AFTER environment;
  END IF;
END //
DELIMITER ;
CALL migration_410_pac_seal_mode();
DROP PROCEDURE IF EXISTS migration_410_pac_seal_mode;
