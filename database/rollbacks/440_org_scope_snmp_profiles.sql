-- Rollback 440 — remove snmp_profiles.organization_id / is_system.
--
-- The unique key is restored FIRST, because the wide version references
-- organization_id and dropping the column with the index still on it fails.
-- Restoring (name, active_flag) can itself fail if two tenants created
-- same-named profiles while 440 was applied — that is a genuine data conflict,
-- not a bug in the rollback, and it is better to fail loudly than to pick a
-- winner silently. Resolve by renaming one, then re-run.
DROP PROCEDURE IF EXISTS rollback_440_org_scope_snmp_profiles;
DELIMITER //
CREATE PROCEDURE rollback_440_org_scope_snmp_profiles()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_profiles'
      AND INDEX_NAME = 'uq_snmp_profiles_name'
      AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE snmp_profiles DROP INDEX uq_snmp_profiles_name;
    ALTER TABLE snmp_profiles ADD UNIQUE KEY uq_snmp_profiles_name (name, active_flag);
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_profiles'
      AND CONSTRAINT_NAME = 'fk_snmp_profiles_org'
  ) THEN
    ALTER TABLE snmp_profiles DROP FOREIGN KEY fk_snmp_profiles_org;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_profiles'
      AND INDEX_NAME = 'idx_snmp_profiles_org'
  ) THEN
    ALTER TABLE snmp_profiles DROP INDEX idx_snmp_profiles_org;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_profiles'
      AND COLUMN_NAME = 'organization_id'
  ) THEN
    ALTER TABLE snmp_profiles DROP COLUMN organization_id, DROP COLUMN is_system;
  END IF;
END //
DELIMITER ;

CALL rollback_440_org_scope_snmp_profiles();
DROP PROCEDURE IF EXISTS rollback_440_org_scope_snmp_profiles;
