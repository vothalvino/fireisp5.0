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
  -- ORDER MATTERS, AND THE INDEX MUST GO EXPLICITLY.
  -- Dropping a column does NOT drop a MULTI-column index that contains it —
  -- MySQL removes the column from the index and keeps the rest. idx_dcb_org is
  -- (organization_id, device_id, created_at), so dropping only the column left
  -- an idx_dcb_org over (device_id, created_at) behind, and re-running the
  -- forward migration then died with ER_DUP_KEYNAME "Duplicate key name
  -- 'idx_dcb_org'". Caught by the CI rollback round-trip, not by review.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'device_config_backups'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE device_config_backups DROP FOREIGN KEY fk_dcb_org;
    ALTER TABLE device_config_backups DROP COLUMN organization_id;
  END IF;

  -- Separate from the column check on purpose: the index can outlive the column
  -- (see above), so a state with no column but a stale index must still clean up.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'device_config_backups'
      AND INDEX_NAME   = 'idx_dcb_org'
  ) THEN
    ALTER TABLE device_config_backups DROP INDEX idx_dcb_org;
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

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'recurring_payment_profiles'
      AND INDEX_NAME   = 'idx_rpp_org'
  ) THEN
    ALTER TABLE recurring_payment_profiles DROP INDEX idx_rpp_org;
  END IF;
END //
DELIMITER ;

CALL rollback_425_org_scope_leaky_tables();
DROP PROCEDURE IF EXISTS rollback_425_org_scope_leaky_tables;
