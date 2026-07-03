-- =============================================================================
-- Rollback 372: remove sysUpTime OID seeds and the uptime_ticks column
-- =============================================================================

-- Remove the seeded sysUpTime OID rows from all profiles
DELETE FROM snmp_profile_oids
WHERE oid = '1.3.6.1.2.1.1.3.0'
  AND metric_column = 'uptime_ticks';

-- Drop uptime_ticks column (guarded; MySQL 8 has no DROP COLUMN IF EXISTS)
DROP PROCEDURE IF EXISTS rollback_372_drop_uptime;
DELIMITER $$
CREATE PROCEDURE rollback_372_drop_uptime()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'uptime_ticks'
  ) THEN
    ALTER TABLE snmp_metrics DROP COLUMN uptime_ticks;
  END IF;
END$$
DELIMITER ;
CALL rollback_372_drop_uptime();
DROP PROCEDURE IF EXISTS rollback_372_drop_uptime;
