-- =============================================================================
-- Migration 449 — PROFECO registration number + Carta de Derechos URL
-- =============================================================================
-- Two small MX-compliance finishers on the organization's fiscal identity:
--
--   * profeco_registro — the registration number PROFECO assigns to the ISP's
--     contrato de adhesión (LFTR art. 191). Printed on the signed activation
--     contract via the {{org.profeco_registro}} placeholder, so re-registration
--     updates one field instead of every template body.
--
--   * carta_derechos_url — where the ISP hosts (or links) the IFT "Carta de
--     Derechos Mínimos de los Usuarios". Surfaced in the client portal footer
--     and under the activation-contract signing screen, so availability is
--     part of the same onboarding record. NULL = fall back to the official
--     IFT document URL in code.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_449_mx_legal_pair;
DELIMITER //
CREATE PROCEDURE migration_449_mx_legal_pair()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organization_mx_profiles'
      AND COLUMN_NAME  = 'profeco_registro'
  ) THEN
    ALTER TABLE organization_mx_profiles
      ADD COLUMN profeco_registro VARCHAR(50) NULL
          COMMENT 'PROFECO adhesion-contract registration number (LFTR art. 191); printed on the activation contract via {{org.profeco_registro}} (migration 449)',
      ADD COLUMN carta_derechos_url VARCHAR(500) NULL
          COMMENT 'URL of the Carta de Derechos Minimos de los Usuarios; NULL = official IFT document (migration 449)';
  END IF;
END //
DELIMITER ;

CALL migration_449_mx_legal_pair();
DROP PROCEDURE IF EXISTS migration_449_mx_legal_pair;
