-- =============================================================================
-- Rollback 230: Remove RADIUS accounting ingest columns from connection_logs
-- =============================================================================
-- Reverses migration 230. Drops the six accounting columns and the index added
-- for RADIUS Phase C accounting ingest support.
--
-- IMPORTANT — connection_logs is PARTITIONED. MySQL does not support
-- DROP COLUMN IF EXISTS, so each drop uses a stored-procedure guard.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop index: idx_conn_logs_acct_session_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_230_drop_idx_acct_session_id;
DELIMITER //
CREATE PROCEDURE rollback_230_drop_idx_acct_session_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND INDEX_NAME   = 'idx_conn_logs_acct_session_id'
  ) THEN
    ALTER TABLE connection_logs
      DROP INDEX idx_conn_logs_acct_session_id;
  END IF;
END //
DELIMITER ;
CALL rollback_230_drop_idx_acct_session_id();
DROP PROCEDURE IF EXISTS rollback_230_drop_idx_acct_session_id;

-- ---------------------------------------------------------------------------
-- Drop column: framed_ipv6_prefix
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_230_drop_framed_ipv6_prefix;
DELIMITER //
CREATE PROCEDURE rollback_230_drop_framed_ipv6_prefix()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'framed_ipv6_prefix'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN framed_ipv6_prefix;
  END IF;
END //
DELIMITER ;
CALL rollback_230_drop_framed_ipv6_prefix();
DROP PROCEDURE IF EXISTS rollback_230_drop_framed_ipv6_prefix;

-- ---------------------------------------------------------------------------
-- Drop column: framed_ip
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_230_drop_framed_ip;
DELIMITER //
CREATE PROCEDURE rollback_230_drop_framed_ip()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'framed_ip'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN framed_ip;
  END IF;
END //
DELIMITER ;
CALL rollback_230_drop_framed_ip();
DROP PROCEDURE IF EXISTS rollback_230_drop_framed_ip;

-- ---------------------------------------------------------------------------
-- Drop column: calling_station_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_230_drop_calling_station_id;
DELIMITER //
CREATE PROCEDURE rollback_230_drop_calling_station_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'calling_station_id'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN calling_station_id;
  END IF;
END //
DELIMITER ;
CALL rollback_230_drop_calling_station_id();
DROP PROCEDURE IF EXISTS rollback_230_drop_calling_station_id;

-- ---------------------------------------------------------------------------
-- Drop column: called_station_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_230_drop_called_station_id;
DELIMITER //
CREATE PROCEDURE rollback_230_drop_called_station_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'called_station_id'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN called_station_id;
  END IF;
END //
DELIMITER ;
CALL rollback_230_drop_called_station_id();
DROP PROCEDURE IF EXISTS rollback_230_drop_called_station_id;

-- ---------------------------------------------------------------------------
-- Drop column: nas_port_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_230_drop_nas_port_id;
DELIMITER //
CREATE PROCEDURE rollback_230_drop_nas_port_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'nas_port_id'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN nas_port_id;
  END IF;
END //
DELIMITER ;
CALL rollback_230_drop_nas_port_id();
DROP PROCEDURE IF EXISTS rollback_230_drop_nas_port_id;

-- ---------------------------------------------------------------------------
-- Drop column: acct_session_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_230_drop_acct_session_id;
DELIMITER //
CREATE PROCEDURE rollback_230_drop_acct_session_id()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'acct_session_id'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN acct_session_id;
  END IF;
END //
DELIMITER ;
CALL rollback_230_drop_acct_session_id();
DROP PROCEDURE IF EXISTS rollback_230_drop_acct_session_id;
