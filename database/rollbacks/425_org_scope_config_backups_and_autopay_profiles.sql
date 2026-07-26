-- =============================================================================
-- Rollback 425 — drop the organization_id columns added to
--                device_config_backups and recurring_payment_profiles
-- =============================================================================
-- WARNING: rolling this back REOPENS a cross-tenant read and write hole. Both
-- tables become unscoped again the moment the models' hasOrgScope is flipped
-- back, because src/models/BaseModel.js omits the org predicate silently rather
-- than raising. Only run this to unblock a failed deploy, and revert the code
-- in the same step.
--
-- The rows deleted by the forward migration (orphans whose parent device or
-- client no longer existed) are NOT restored — they were unattributable and
-- already unreachable through the API.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_425_org_scope_leaky_tables;
DELIMITER //
CREATE PROCEDURE rollback_425_org_scope_leaky_tables()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'device_config_backups'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    -- The FK must go before the column; the index goes with it.
    ALTER TABLE device_config_backups DROP FOREIGN KEY fk_dcb_org;
    ALTER TABLE device_config_backups DROP COLUMN organization_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'recurring_payment_profiles'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE recurring_payment_profiles DROP FOREIGN KEY fk_rpp_org;
    ALTER TABLE recurring_payment_profiles DROP COLUMN organization_id;
  END IF;
END //
DELIMITER ;

CALL rollback_425_org_scope_leaky_tables();
DROP PROCEDURE IF EXISTS rollback_425_org_scope_leaky_tables;
