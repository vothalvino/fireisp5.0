-- =============================================================================
-- Migration 416 — Mexican default IVA + per-client IVA exemption
-- =============================================================================
-- Fixes "the IVA problem": Mexican (locale='MX') orgs must charge IVA (16 %) on
-- everything by default, but every billing path resolves tax via
-- `tax_rates WHERE organization_id = ? AND is_default = TRUE` and falls back to
-- 0 % when no per-org default exists. The seeded "IVA 16% (Mexico)" rate is a
-- GLOBAL (organization_id IS NULL, is_default=FALSE) row the per-org lookup
-- never matches, so MX invoices silently came out untaxed.
--
-- Two changes:
--   1. Seed a per-org, is_default=TRUE "IVA 16%" rate for every MX org that
--      lacks an active default rate (idempotent; editable afterwards — e.g. an
--      org in the northern border region can change it to 8 %).
--   2. clients.tax_exempt (+ reason): mark specific clients (the genuinely
--      exempt institutions/entities) so their invoices carry 0 % / Exento.
--      IVA exemption in Mexico is determined per taxpayer/act, not by a blanket
--      "government" rule — most government bodies DO pay IVA — so this is an
--      explicit, admin-set flag, not an automatic classification.
--
-- Column adds are guarded via INFORMATION_SCHEMA so the migration is idempotent
-- (see migration 371/374/390 pattern).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_416_client_tax_exempt;
DELIMITER //
CREATE PROCEDURE migration_416_client_tax_exempt()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'tax_exempt'
  ) THEN
    ALTER TABLE clients
      ADD COLUMN tax_exempt TINYINT(1) NOT NULL DEFAULT 0
          COMMENT 'When 1, this client is IVA-exempt: invoices carry 0% / Exento regardless of the org default rate (migration 416)'
          AFTER suspension_exempt_reason,
      ADD COLUMN tax_exempt_reason VARCHAR(255) NULL
          COMMENT 'Optional explanation / legal basis for the IVA exemption (migration 416)'
          AFTER tax_exempt;
  END IF;
END //
DELIMITER ;
CALL migration_416_client_tax_exempt();
DROP PROCEDURE IF EXISTS migration_416_client_tax_exempt;

-- ---------------------------------------------------------------------------
-- Seed a per-org default IVA 16% rate for every MX org that has no active
-- default rate. Naturally idempotent (NOT EXISTS on an active default).
-- ---------------------------------------------------------------------------
INSERT INTO tax_rates (organization_id, name, rate, description, is_default, status)
SELECT o.id, 'IVA 16%', 0.1600,
       'Impuesto al Valor Agregado 16% — default for this Mexican organization (migration 416). Editable; e.g. set 8% for the northern border region.',
       TRUE, 'active'
FROM organizations o
WHERE o.locale = 'MX'
  AND o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM tax_rates t
    WHERE t.organization_id = o.id
      AND t.is_default = TRUE
      AND t.status = 'active'
      AND t.deleted_at IS NULL
  );
