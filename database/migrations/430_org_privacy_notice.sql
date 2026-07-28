-- =============================================================================
-- Migration 430 — per-org privacy notice text and version (LFPDPPP)
--                 + the missing organizations.logo_url column
-- =============================================================================
-- The consent machinery has existed since migration 314 (subscriber_consents +
-- /regulatory-compliance/consent), but nothing in the product ever DISPLAYED a
-- privacy notice or wrote a consent row — so "prove this subscriber accepted
-- your aviso de privacidad" had no answer. The notice itself needs a home
-- before the portal can render it.
--
-- Real columns, not the settings table: Organization.getSettings ignores its
-- org argument (the settings table is install-global — the known per-org-ness
-- gap), and its values are capped at 5000 chars, which a real aviso integral
-- exceeds. A privacy notice is per-org legal content (it must name the
-- responsable — THIS ISP, not the install) with a version that gates whether
-- an old acceptance is still current.
--
-- Both NULL by default: the app falls back to a bundled template interpolated
-- with the org's own name/address (privacyNoticeService), so the portal never
-- renders an empty page, and an org that pastes its lawyer's text takes over
-- from the template. privacy_notice_version is VARCHAR(20) to match
-- subscriber_consents.consent_version exactly — the two are compared for
-- equality to decide whether a subscriber must re-accept.
--
-- RIDE-ALONG FIX, same table: organizations.logo_url never existed. The whole
-- chain above it did — Organization.fillable lists it, the create/update
-- validation schemas accept it, and OrganizationDetail renders a "Logo URL"
-- input — so filling that field 500'd with ER_BAD_FIELD_ERROR (confirmed live
-- on the demo, 2026-07-27). Every empty save survived only because the form
-- drops empty strings. sql:check never saw it: BaseModel's column list is
-- dynamic SQL, which the checker skips rather than guesses.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_430_org_privacy_notice;
DELIMITER //
CREATE PROCEDURE migration_430_org_privacy_notice()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND COLUMN_NAME  = 'logo_url'
  ) THEN
    ALTER TABLE organizations
      ADD COLUMN logo_url VARCHAR(500) NULL AFTER notes;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND COLUMN_NAME  = 'privacy_notice'
  ) THEN
    ALTER TABLE organizations
      ADD COLUMN privacy_notice MEDIUMTEXT NULL
          COMMENT 'Org-specific privacy notice (markdown). NULL = bundled template (migration 430)'
          AFTER logo_url,
      ADD COLUMN privacy_notice_version VARCHAR(20) NULL
          COMMENT 'Version compared to subscriber_consents.consent_version; bump to force re-acceptance (migration 430)'
          AFTER privacy_notice;
  END IF;
END //
DELIMITER ;

CALL migration_430_org_privacy_notice();
DROP PROCEDURE IF EXISTS migration_430_org_privacy_notice;
