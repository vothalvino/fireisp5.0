-- Rollback 438 — remove speed_tests.organization_id.
--
-- Drops the FK and index first: dropping the column alone leaves
-- idx_speed_tests_org behind, and a re-run of 438 then fails with
-- ER_DUP_KEYNAME. 438 guards against that on the way in too, but a rollback
-- should not depend on the forward migration cleaning up after it.
--
-- tested_at KEEPS its DEFAULT CURRENT_TIMESTAMP. Reverting it would restore a
-- column that MySQL 8 rejects every INSERT against (ER_NO_DEFAULT_FOR_FIELD),
-- i.e. it would re-break POST /speed-tests, and the default is orthogonal to
-- org scoping. A rollback undoes the tenancy change, not the bug fix.
DROP PROCEDURE IF EXISTS rollback_438_org_scope_speed_tests;
DELIMITER //
CREATE PROCEDURE rollback_438_org_scope_speed_tests()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'speed_tests'
      AND CONSTRAINT_NAME = 'fk_speed_tests_org'
  ) THEN
    ALTER TABLE speed_tests DROP FOREIGN KEY fk_speed_tests_org;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'speed_tests'
      AND INDEX_NAME = 'idx_speed_tests_org'
  ) THEN
    ALTER TABLE speed_tests DROP INDEX idx_speed_tests_org;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'speed_tests'
      AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE speed_tests DROP COLUMN organization_id;
  END IF;
END //
DELIMITER ;

CALL rollback_438_org_scope_speed_tests();
DROP PROCEDURE IF EXISTS rollback_438_org_scope_speed_tests;
