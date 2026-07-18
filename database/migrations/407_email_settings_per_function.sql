-- =============================================================================
-- Migration 407 — Per-function outbound email identities
-- =============================================================================
-- organization_email_settings (migration 386) held ONE SMTP identity per org
-- (UNIQUE KEY on organization_id). This migration lets a server manager
-- configure a separate outbound identity per function — general, support,
-- billing, noc — each with its own from-address and optional SMTP override,
-- so e.g. billing mail comes from billing@isp and NOC alerts from noc@isp.
--
--   * adds email_function ENUM('general','support','billing','noc') NOT NULL
--     DEFAULT 'general' — existing rows become the 'general' identity via the
--     default, preserving current behavior exactly.
--   * replaces UNIQUE(organization_id) with UNIQUE(organization_id,
--     email_function) so each function gets its own row.
--
-- Resolution at send time (emailTransport.getOrgTransport): the requested
-- function's row → the org's 'general' row → the global SMTP env config. So a
-- function left unconfigured transparently inherits general/global — nothing
-- breaks if a manager only sets 'general'.
--
-- ALTERs are INFORMATION_SCHEMA-guarded inside a stored procedure (371/374/
-- 386 convention) — idempotent, safe to re-run.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_407_email_function;
DELIMITER //
CREATE PROCEDURE migration_407_email_function()
BEGIN
  -- 1. Add the email_function column (existing rows default to 'general').
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_email_settings' AND COLUMN_NAME = 'email_function'
  ) THEN
    ALTER TABLE organization_email_settings
      ADD COLUMN email_function ENUM('general', 'support', 'billing', 'noc')
        NOT NULL DEFAULT 'general'
        COMMENT 'Which outbound function this identity serves; unconfigured functions fall back to general, then global (migration 407)'
        AFTER organization_id;
  END IF;

  -- 2. Swap UNIQUE(organization_id) -> UNIQUE(organization_id, email_function).
  --    The old unique key is the ONLY index covering the organization_id FK
  --    column (migration 386: PK is on id, no separate KEY(organization_id)).
  --    InnoDB rejects DROP INDEX of an FK-covering index unless a replacement
  --    is added in the SAME statement (error 1553). So the drop and add MUST
  --    be one ALTER — mirroring migration 361's org-number unique swaps.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_email_settings'
      AND INDEX_NAME = 'uq_organization_email_settings_org_function'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_email_settings'
        AND INDEX_NAME = 'uq_organization_email_settings_org'
    ) THEN
      ALTER TABLE organization_email_settings
        DROP INDEX uq_organization_email_settings_org,
        ADD UNIQUE KEY uq_organization_email_settings_org_function (organization_id, email_function);
    ELSE
      ALTER TABLE organization_email_settings
        ADD UNIQUE KEY uq_organization_email_settings_org_function (organization_id, email_function);
    END IF;
  END IF;
END//
DELIMITER ;
CALL migration_407_email_function();
DROP PROCEDURE IF EXISTS migration_407_email_function;
