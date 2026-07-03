-- =============================================================================
-- Migration 372: Device uptime metric (SNMP sysUpTime)
-- =============================================================================
-- Adds uptime_ticks (sysUpTime, TimeTicks = hundredths of a second) to the raw
-- snmp_metrics table and seeds the standard MIB-II sysUpTime scalar OID
-- (1.3.6.1.2.1.1.3.0) for EVERY existing SNMP profile so the poller collects it.
--
-- uptime_ticks is a monotonic counter that RESETS to 0 on reboot and WRAPS at
-- 2^32, so it is intentionally NOT added to the AVG-based 1hr/1day rollups
-- (averaging it is meaningless). The Operations Console reads the latest raw
-- value per device and formats it as "312d 4h".
--
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS -> guarded via an INFORMATION_SCHEMA
-- stored procedure (same pattern as migrations 255 / 264 / 371).
-- The seed uses INSERT ... SELECT FROM snmp_profiles (a real FROM clause) with a
-- NOT EXISTS guard -> idempotent and MySQL-valid (no FROM DUAL needed).
--
-- Requires: 025_create_snmp_metrics_table, 029_create_snmp_profiles_table,
--           030_create_snmp_profile_oids_table
-- =============================================================================

-- Part 1: add uptime_ticks column to snmp_metrics (guarded ADD COLUMN)
DROP PROCEDURE IF EXISTS migration_372_add_uptime;
DELIMITER $$
CREATE PROCEDURE migration_372_add_uptime()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'uptime_ticks'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN uptime_ticks BIGINT NULL
        COMMENT 'sysUpTime in TimeTicks (hundredths of a second); resets on reboot'
        AFTER rx_rate_mbps;
  END IF;
END$$
DELIMITER ;
CALL migration_372_add_uptime();
DROP PROCEDURE IF EXISTS migration_372_add_uptime;

-- Part 2: seed the standard sysUpTime scalar OID for every existing profile
INSERT INTO snmp_profile_oids
    (profile_id, oid, metric_column, label, oid_type, is_per_interface, sort_order)
SELECT
    p.id,
    '1.3.6.1.2.1.1.3.0',
    'uptime_ticks',
    'System Uptime (sysUpTime)',
    'timeticks',
    FALSE,
    5
FROM snmp_profiles p
WHERE NOT EXISTS (
    SELECT 1 FROM snmp_profile_oids spo
    WHERE spo.profile_id = p.id
      AND spo.oid = '1.3.6.1.2.1.1.3.0'
);

-- END OF MIGRATION 372
