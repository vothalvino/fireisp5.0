-- =============================================================================
-- Migration 230: RADIUS Accounting Ingest Columns (Phase C)
-- =============================================================================
-- Implements isp-platform-features.md §3.3 "RADIUS Accounting Phase C":
--   Adds accounting-specific columns to connection_logs so that FreeRADIUS
--   Accounting-Request packets (Start / Interim-Update / Stop) can be stored
--   with full fidelity alongside the existing session and event columns.
--
-- IMPORTANT — connection_logs is a PARTITIONED table:
--   • NO foreign-key constraints may be added to it.
--   • NO NOT NULL columns without a DEFAULT may be added.
--   • All column additions use stored-procedure IF NOT EXISTS guards because
--     MySQL does not support ADD COLUMN IF NOT EXISTS.
--
-- Columns added (all NULL — safe on partitioned tables):
--   acct_session_id     VARCHAR(64)  NULL — FreeRADIUS Acct-Session-Id attribute
--                                           (distinct from the older session_id)
--   nas_port_id         VARCHAR(100) NULL — NAS-Port-Id string (e.g. "eth0/0/0.1")
--   called_station_id   VARCHAR(100) NULL — Called-Station-Id (MAC or circuit-ID)
--   calling_station_id  VARCHAR(100) NULL — Calling-Station-Id (subscriber MAC)
--   framed_ip           VARCHAR(45)  NULL — Framed-IP-Address (IPv4, 45 chars max)
--   framed_ipv6_prefix  VARCHAR(64)  NULL — Framed-IPv6-Prefix (e.g. "2001:db8::/48")
--
-- Note: terminate_cause VARCHAR(64) already exists — NOT added again.
--
-- Index added:
--   idx_conn_logs_acct_session_id on connection_logs(acct_session_id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Column: acct_session_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_230_add_acct_session_id;
DELIMITER //
CREATE PROCEDURE migration_230_add_acct_session_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'acct_session_id'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN acct_session_id VARCHAR(64) NULL
        COMMENT 'FreeRADIUS Acct-Session-Id attribute; unique per NAS session'
        AFTER session_id;
  END IF;
END //
DELIMITER ;
CALL migration_230_add_acct_session_id();
DROP PROCEDURE IF EXISTS migration_230_add_acct_session_id;

-- ---------------------------------------------------------------------------
-- Column: nas_port_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_230_add_nas_port_id;
DELIMITER //
CREATE PROCEDURE migration_230_add_nas_port_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'nas_port_id'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN nas_port_id VARCHAR(100) NULL
        COMMENT 'NAS-Port-Id string attribute (e.g. "eth0/0/0.1", "slot/port")'
        AFTER acct_session_id;
  END IF;
END //
DELIMITER ;
CALL migration_230_add_nas_port_id();
DROP PROCEDURE IF EXISTS migration_230_add_nas_port_id;

-- ---------------------------------------------------------------------------
-- Column: called_station_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_230_add_called_station_id;
DELIMITER //
CREATE PROCEDURE migration_230_add_called_station_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'called_station_id'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN called_station_id VARCHAR(100) NULL
        COMMENT 'Called-Station-Id (upstream MAC address or circuit-ID of the NAS port)'
        AFTER nas_port_id;
  END IF;
END //
DELIMITER ;
CALL migration_230_add_called_station_id();
DROP PROCEDURE IF EXISTS migration_230_add_called_station_id;

-- ---------------------------------------------------------------------------
-- Column: calling_station_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_230_add_calling_station_id;
DELIMITER //
CREATE PROCEDURE migration_230_add_calling_station_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'calling_station_id'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN calling_station_id VARCHAR(100) NULL
        COMMENT 'Calling-Station-Id (subscriber CPE MAC address, e.g. "AA:BB:CC:DD:EE:FF")'
        AFTER called_station_id;
  END IF;
END //
DELIMITER ;
CALL migration_230_add_calling_station_id();
DROP PROCEDURE IF EXISTS migration_230_add_calling_station_id;

-- ---------------------------------------------------------------------------
-- Column: framed_ip
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_230_add_framed_ip;
DELIMITER //
CREATE PROCEDURE migration_230_add_framed_ip()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'framed_ip'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN framed_ip VARCHAR(45) NULL
        COMMENT 'Framed-IP-Address as reported by the NAS in the Accounting-Request'
        AFTER calling_station_id;
  END IF;
END //
DELIMITER ;
CALL migration_230_add_framed_ip();
DROP PROCEDURE IF EXISTS migration_230_add_framed_ip;

-- ---------------------------------------------------------------------------
-- Column: framed_ipv6_prefix
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_230_add_framed_ipv6_prefix;
DELIMITER //
CREATE PROCEDURE migration_230_add_framed_ipv6_prefix()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'framed_ipv6_prefix'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN framed_ipv6_prefix VARCHAR(64) NULL
        COMMENT 'Framed-IPv6-Prefix delegated to the subscriber (e.g. "2001:db8::/48")'
        AFTER framed_ip;
  END IF;
END //
DELIMITER ;
CALL migration_230_add_framed_ipv6_prefix();
DROP PROCEDURE IF EXISTS migration_230_add_framed_ipv6_prefix;

-- ---------------------------------------------------------------------------
-- Index: idx_conn_logs_acct_session_id
-- Wrapped in a stored-procedure guard checking INFORMATION_SCHEMA.STATISTICS.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_230_add_idx_acct_session_id;
DELIMITER //
CREATE PROCEDURE migration_230_add_idx_acct_session_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND INDEX_NAME   = 'idx_conn_logs_acct_session_id'
  ) THEN
    ALTER TABLE connection_logs
      ADD INDEX idx_conn_logs_acct_session_id (acct_session_id);
  END IF;
END //
DELIMITER ;
CALL migration_230_add_idx_acct_session_id();
DROP PROCEDURE IF EXISTS migration_230_add_idx_acct_session_id;
