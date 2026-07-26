-- =============================================================================
-- Rollback 426 — drop radius.organization_id
-- =============================================================================
-- WARNING: this REOPENS cross-tenant WRITE on subscriber PPPoE credentials the
-- moment src/models/Radius.js's hasOrgScope goes back to false. Reads stay
-- scoped either way (the model's JOIN overrides), which is precisely what made
-- the hole hard to see. Revert the code in the same step.
--
-- The index is dropped EXPLICITLY and in its own guarded block: dropping a
-- column does not drop a multi-column index containing it — MySQL removes the
-- column and keeps the rest — so the index can outlive the column, and a stale
-- one makes the forward migration fail with ER_DUP_KEYNAME.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_426_org_scope_radius;
DELIMITER //
CREATE PROCEDURE rollback_426_org_scope_radius()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE radius DROP FOREIGN KEY fk_radius_org;
    ALTER TABLE radius DROP COLUMN organization_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND INDEX_NAME   = 'idx_radius_org'
  ) THEN
    ALTER TABLE radius DROP INDEX idx_radius_org;
  END IF;
END //
DELIMITER ;

CALL rollback_426_org_scope_radius();
DROP PROCEDURE IF EXISTS rollback_426_org_scope_radius;
