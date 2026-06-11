-- =============================================================================
-- Rollback 250: Remove SNMPv3 columns from devices + drop discovery tables
-- =============================================================================
-- Reverses migration 250.
-- discovery_results must be dropped before discovery_scans (FK dependency).
-- Column drops use INFORMATION_SCHEMA guards (MySQL 8 has no DROP COLUMN IF EXISTS).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_250_alter_devices;
DELIMITER $$
CREATE PROCEDURE rollback_250_alter_devices()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'devices'
      AND COLUMN_NAME  = 'snmp_v3_security_name'
  ) THEN
    ALTER TABLE devices
      DROP COLUMN snmp_v3_security_name,
      DROP COLUMN snmp_v3_auth_protocol,
      DROP COLUMN snmp_v3_auth_key_encrypted,
      DROP COLUMN snmp_v3_priv_protocol,
      DROP COLUMN snmp_v3_priv_key_encrypted,
      DROP COLUMN snmp_v3_context_name,
      DROP COLUMN last_polled_at,
      DROP COLUMN last_poll_error;
  END IF;
END$$
DELIMITER ;
CALL rollback_250_alter_devices();
DROP PROCEDURE IF EXISTS rollback_250_alter_devices;

DROP TABLE IF EXISTS discovery_results;
DROP TABLE IF EXISTS discovery_scans;
