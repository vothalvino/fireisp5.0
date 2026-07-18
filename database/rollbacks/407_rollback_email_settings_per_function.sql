-- =============================================================================
-- Rollback 407: revert to a single SMTP identity per org
-- =============================================================================
-- WARNING: destructive. If more than one function row exists per org, this
-- keeps only the 'general' row (others are dropped) so the single-column
-- unique key can be restored. Run only if you truly need to revert.

DROP PROCEDURE IF EXISTS rollback_407_email_function;
DELIMITER //
CREATE PROCEDURE rollback_407_email_function()
BEGIN
  -- Drop every non-general identity so organization_id becomes unique again.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_email_settings' AND COLUMN_NAME = 'email_function'
  ) THEN
    DELETE FROM organization_email_settings WHERE email_function <> 'general';
  END IF;

  -- Swap composite -> single-column unique in ONE ALTER: the composite is the
  -- FK-covering index (organization_id leftmost), so a standalone DROP would
  -- fail with error 1553. Mirrors the forward migration.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_email_settings'
      AND INDEX_NAME = 'uq_organization_email_settings_org'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_email_settings'
        AND INDEX_NAME = 'uq_organization_email_settings_org_function'
    ) THEN
      ALTER TABLE organization_email_settings
        DROP INDEX uq_organization_email_settings_org_function,
        ADD UNIQUE KEY uq_organization_email_settings_org (organization_id);
    ELSE
      ALTER TABLE organization_email_settings
        ADD UNIQUE KEY uq_organization_email_settings_org (organization_id);
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_email_settings' AND COLUMN_NAME = 'email_function'
  ) THEN
    ALTER TABLE organization_email_settings DROP COLUMN email_function;
  END IF;
END//
DELIMITER ;
CALL rollback_407_email_function();
DROP PROCEDURE IF EXISTS rollback_407_email_function;
