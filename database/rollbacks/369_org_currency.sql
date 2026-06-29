-- =============================================================================
-- Rollback 369 — Remove currency column from organizations
-- =============================================================================
-- Reverses migration 369. Drops the currency column added to organizations.
-- WARNING: All per-org currency configuration is lost on rollback.
--
-- MySQL 8 does not support DROP COLUMN IF EXISTS, so the drop is guarded by
-- an INFORMATION_SCHEMA check inside a stored procedure.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_369_org_currency;
DELIMITER //
CREATE PROCEDURE rollback_369_org_currency()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'organizations'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE organizations DROP COLUMN currency;
  END IF;
END //
DELIMITER ;
CALL rollback_369_org_currency();
DROP PROCEDURE IF EXISTS rollback_369_org_currency;
