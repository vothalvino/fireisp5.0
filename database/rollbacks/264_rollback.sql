-- =============================================================================
-- Rollback 264: Remove BNG/OLT/Switch OID seeds and if_oper_status column
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Remove seeded OID rows for new profiles
-- ---------------------------------------------------------------------------
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles sp ON sp.id = spo.profile_id
WHERE sp.name IN ('Cisco BNG', 'Juniper BNG', 'Huawei OLT', 'ZTE OLT')
  AND sp.organization_id IS NULL;

-- Remove extended switch OIDs added in this migration (identified by sort_order
-- values 11, 21, 35, 45, 55, 65 on the Generic Switch profile)
DELETE spo
FROM snmp_profile_oids spo
JOIN snmp_profiles sp ON sp.id = spo.profile_id
WHERE sp.name = 'Generic Switch'
  AND sp.organization_id IS NULL
  AND spo.sort_order IN (11, 21, 35, 45, 55, 65);

-- ---------------------------------------------------------------------------
-- Remove new profiles
-- ---------------------------------------------------------------------------
DELETE FROM snmp_profiles
WHERE name IN ('Cisco BNG', 'Juniper BNG', 'Huawei OLT', 'ZTE OLT')
  AND organization_id IS NULL;

-- ---------------------------------------------------------------------------
-- Drop if_oper_status columns from rollup tables first, then raw table
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_264_drop_oper_status;
DELIMITER $$
CREATE PROCEDURE rollback_264_drop_oper_status()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1day'
      AND COLUMN_NAME  = 'avg_if_oper_status'
  ) THEN
    ALTER TABLE snmp_metrics_1day
      DROP COLUMN avg_if_oper_status,
      DROP COLUMN min_if_oper_status,
      DROP COLUMN max_if_oper_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1hr'
      AND COLUMN_NAME  = 'avg_if_oper_status'
  ) THEN
    ALTER TABLE snmp_metrics_1hr
      DROP COLUMN avg_if_oper_status,
      DROP COLUMN min_if_oper_status,
      DROP COLUMN max_if_oper_status;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'if_oper_status'
  ) THEN
    ALTER TABLE snmp_metrics DROP COLUMN if_oper_status;
  END IF;
END$$
DELIMITER ;

CALL rollback_264_drop_oper_status();
DROP PROCEDURE IF EXISTS rollback_264_drop_oper_status;
