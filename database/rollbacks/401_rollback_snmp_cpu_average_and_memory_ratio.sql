-- =============================================================================
-- Rollback 401 — revert cpu_usage to bare-scalar, remove the hrStorageTable
-- memory_usage re-seed, drop the aggregate column
-- =============================================================================
-- Order matters: the data reverts run FIRST (Steps 1-2, while the aggregate
-- column still exists), THEN the column is dropped last (Step 3).

-- Step 1: revert the hrProcessorLoad cpu_usage rows back to their pre-401
-- bare-scalar shape. Scoped to the EXACT WHERE the forward migration used
-- (oid + metric_column, ignoring deleted_at so a since-soft-deleted row is
-- still reverted) so this can never touch a row the forward migration didn't
-- touch.
UPDATE snmp_profile_oids
SET is_per_interface = FALSE, aggregate = FALSE
WHERE oid = '1.3.6.1.2.1.25.3.3.1.2'
  AND metric_column = 'cpu_usage';

-- Step 2: remove the re-seeded hrStorageTable-ratio memory_usage rows for the
-- two profiles the forward migration re-seeded. Hard DELETE mirrors migration
-- 398's own Part-1 DELETE of the original broken rows — nothing worth
-- auditing, symmetric with how they were reintroduced.
DELETE spo FROM snmp_profile_oids spo
JOIN snmp_profiles p ON p.id = spo.profile_id
WHERE spo.oid = '1.3.6.1.2.1.25.2.3.1.6'
  AND spo.metric_column = 'memory_usage'
  AND p.name IN ('Generic IF-MIB', 'MikroTik RouterOS');

-- Step 3: drop the aggregate column (guarded; MySQL has no DROP COLUMN IF EXISTS)
DROP PROCEDURE IF EXISTS rollback_401_drop_aggregate_from_snmp_profile_oids;
DELIMITER //
CREATE PROCEDURE rollback_401_drop_aggregate_from_snmp_profile_oids()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_profile_oids'
      AND COLUMN_NAME  = 'aggregate'
  ) THEN
    ALTER TABLE snmp_profile_oids DROP COLUMN aggregate;
  END IF;
END //
DELIMITER ;
CALL rollback_401_drop_aggregate_from_snmp_profile_oids();
DROP PROCEDURE IF EXISTS rollback_401_drop_aggregate_from_snmp_profile_oids;
