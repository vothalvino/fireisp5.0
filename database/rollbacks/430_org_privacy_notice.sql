-- =============================================================================
-- Rollback 430 — drop the per-org privacy notice columns
-- =============================================================================
-- Consent rows in subscriber_consents are untouched: they carry their own
-- consent_version copy, so history survives the notice columns going away.
-- logo_url is dropped too — before 430 the column never existed, so restoring
-- that state is what a rollback means here.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_430_org_privacy_notice;
DELIMITER //
CREATE PROCEDURE rollback_430_org_privacy_notice()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND COLUMN_NAME  = 'privacy_notice'
  ) THEN
    ALTER TABLE organizations
      DROP COLUMN privacy_notice,
      DROP COLUMN privacy_notice_version;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND COLUMN_NAME  = 'logo_url'
  ) THEN
    ALTER TABLE organizations DROP COLUMN logo_url;
  END IF;
END //
DELIMITER ;

CALL rollback_430_org_privacy_notice();
DROP PROCEDURE IF EXISTS rollback_430_org_privacy_notice;
