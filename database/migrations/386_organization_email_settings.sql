-- =============================================================================
-- Migration 386 — Per-organization outbound email (SMTP) configuration
-- =============================================================================
-- Adds `organization_email_settings`, a one-row-per-org SMTP configuration
-- table mirroring `organization_database_configs` (migration 167) exactly:
-- an AES-256-GCM encrypted secret column (`smtp_password_encrypted`, via
-- src/utils/encryption.js), never returned in any HTTP response — GET
-- /email-settings exposes only `configured: boolean`.
--
-- Also adds `email_logs.organization_id` (nullable, backfilled from
-- clients.organization_id where resolvable) so the newly org-aware
-- `emailTransport.sendEmail({ organizationId, clientId, ... })` can write a
-- tenant-attributable audit row. Guarded via INFORMATION_SCHEMA inside a
-- stored procedure (371/374/380/381 convention) — idempotent, safe to re-run.
--
-- New permission slugs `email_settings.view` / `email_settings.update` are
-- granted to admin + super_admin ONLY — an SMTP credential is org-wide
-- send-as-anyone infrastructure with no natural business-role owner, mirroring
-- migration 377's carve-out for api_tokens/webhooks (excluded even from
-- readonly/auditor's blanket *.view wildcard).
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_email_settings (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED  NOT NULL,
    enabled                 TINYINT(1)       NOT NULL DEFAULT 1 COMMENT 'When 0, org falls back to global SMTP even if fields are populated',
    smtp_host               VARCHAR(255)     NULL,
    smtp_port               INT UNSIGNED     NULL DEFAULT 587,
    smtp_secure             TINYINT(1)       NOT NULL DEFAULT 0,
    smtp_user               VARCHAR(255)     NULL,
    smtp_password_encrypted TEXT             NULL,
    from_email              VARCHAR(255)     NULL,
    from_name               VARCHAR(255)     NULL,
    last_test_at            TIMESTAMP        NULL,
    last_test_status        ENUM('success', 'failed') NULL,
    last_test_error         TEXT             NULL,
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_organization_email_settings_org (organization_id),
    CONSTRAINT fk_organization_email_settings_org
        FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Per-organization outbound SMTP configuration (migration 386) — password encrypted at rest, never returned in API responses';

-- -----------------------------------------------------------------------------
-- email_logs.organization_id — now that sendEmail() gains organizationId/
-- clientId params, tenant-attribute the audit row. Nullable: legacy rows and
-- auth flows with no org in scope (password reset / email verification) stay
-- NULL by design (see src/services/emailTransport.js).
-- -----------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_386_email_logs_org_id;
DELIMITER //
CREATE PROCEDURE migration_386_email_logs_org_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_logs' AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE email_logs
      ADD COLUMN organization_id BIGINT UNSIGNED NULL COMMENT 'Owning org; NULL for legacy rows and auth flows with no org in scope (migration 386)' AFTER client_id,
      ADD KEY idx_email_logs_organization_id (organization_id);

    -- Backfill from clients where resolvable. Rows with no client_id (internal/
    -- user-targeted messages) or an unresolvable client are left NULL.
    UPDATE email_logs el
      JOIN clients c ON c.id = el.client_id
      SET el.organization_id = c.organization_id
      WHERE el.organization_id IS NULL AND el.client_id IS NOT NULL;
  END IF;
END//
DELIMITER ;
CALL migration_386_email_logs_org_id();
DROP PROCEDURE IF EXISTS migration_386_email_logs_org_id;

-- -----------------------------------------------------------------------------
-- Permissions — admin + super_admin ONLY (see header note).
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO permissions (name, description, module) VALUES
    ('email_settings.view',   'View per-organization outbound email (SMTP) configuration', 'settings'),
    ('email_settings.update', 'Configure per-organization outbound email (SMTP) settings, incl. credentials', 'settings');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.name IN ('email_settings.view', 'email_settings.update')
WHERE r.name IN ('admin', 'super_admin');
