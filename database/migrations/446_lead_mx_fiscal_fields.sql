-- =============================================================================
-- Migration 446 — MX fiscal data at lead intake
-- =============================================================================
-- The subscriber flow (migration 445) carries a lead through conversion, the
-- service order, provisioning and the installation invoice — but for an
-- MX-locale organization that invoice cannot be STAMPED until someone
-- manually opens the client's MX fiscal profile and types RFC, régimen and
-- C.P. Nothing in the flow captured them, so every MX onboarding stalled at
-- the stamping gate (RECEPTOR_INCOMPLETE).
--
-- These columns let sales capture the fiscal identity at intake, where the
-- prospect is already answering questions. convertLead copies them into
-- clients (tax_id/curp) and, when the organization is MX-locale and the four
-- stamping-required fields are present, creates the client_mx_profiles row —
-- so the flow ends at a client whose CFDI can actually be filed.
--
-- All NULLable: global-locale orgs and MX prospects who did not bring their
-- fiscal data yet are unaffected.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_446_lead_mx_fiscal;
DELIMITER //
CREATE PROCEDURE migration_446_lead_mx_fiscal()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'leads'
      AND COLUMN_NAME  = 'rfc'
  ) THEN
    ALTER TABLE leads
      ADD COLUMN rfc VARCHAR(13) NULL
          COMMENT 'MX taxpayer id captured at intake; copied to the client fiscal profile on conversion (migration 446)',
      ADD COLUMN curp VARCHAR(18) NULL
          COMMENT 'MX personal id (CURP) captured at intake (migration 446)',
      ADD COLUMN razon_social VARCHAR(300) NULL
          COMMENT 'Fiscal legal name as registered with SAT (migration 446)',
      ADD COLUMN regimen_fiscal VARCHAR(3) NULL
          COMMENT 'SAT regimen fiscal code, e.g. 612 (migration 446)',
      ADD COLUMN codigo_postal_fiscal VARCHAR(5) NULL
          COMMENT 'Fiscal postal code (DomicilioFiscalReceptor) (migration 446)';
  END IF;
END //
DELIMITER ;

CALL migration_446_lead_mx_fiscal();
DROP PROCEDURE IF EXISTS migration_446_lead_mx_fiscal;
