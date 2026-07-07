-- Rollback for migration 375 — remove organization_id from coverage_zones.
-- Drops the FK, the index, and the column. Idempotent — safe to re-run.
DROP PROCEDURE IF EXISTS rollback_375_add_org_to_coverage_zones;
DELIMITER //
CREATE PROCEDURE rollback_375_add_org_to_coverage_zones()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'coverage_zones'
      AND CONSTRAINT_NAME = 'fk_coverage_zones_organization'
  ) THEN
    ALTER TABLE coverage_zones DROP FOREIGN KEY fk_coverage_zones_organization;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'coverage_zones'
      AND COLUMN_NAME  = 'organization_id'
  ) THEN
    ALTER TABLE coverage_zones
      DROP KEY idx_coverage_zones_organization_id,
      DROP COLUMN organization_id;
  END IF;
END //
DELIMITER ;
CALL rollback_375_add_org_to_coverage_zones();
DROP PROCEDURE IF EXISTS rollback_375_add_org_to_coverage_zones;
