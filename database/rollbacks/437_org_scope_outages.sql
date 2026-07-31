-- Rollback 437 — remove outages.organization_id.
--
-- Drops the FK and index first: dropping the column alone leaves
-- idx_outages_org behind, and a re-run of 437 then fails with ER_DUP_KEYNAME.
-- 437 guards against that on the way in too, but a rollback should not depend
-- on the forward migration cleaning up after it.
DROP PROCEDURE IF EXISTS rollback_437_org_scope_outages;
DELIMITER //
CREATE PROCEDURE rollback_437_org_scope_outages()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outages'
      AND CONSTRAINT_NAME = 'fk_outages_org'
  ) THEN
    ALTER TABLE outages DROP FOREIGN KEY fk_outages_org;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outages'
      AND INDEX_NAME = 'idx_outages_org'
  ) THEN
    ALTER TABLE outages DROP INDEX idx_outages_org;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outages'
      AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE outages DROP COLUMN organization_id;
  END IF;
END //
DELIMITER ;

CALL rollback_437_org_scope_outages();
DROP PROCEDURE IF EXISTS rollback_437_org_scope_outages;
