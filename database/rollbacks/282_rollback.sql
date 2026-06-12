-- =============================================================================
-- Rollback 282: Remove PTP link extensions and link_planning_calcs table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Drop link_planning_calcs table
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS link_planning_calcs;

-- ---------------------------------------------------------------------------
-- Part 2: Drop PTP columns from network_links via guarded stored procedure
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _rb282_drop_ptp_columns;

DELIMITER $$

CREATE PROCEDURE _rb282_drop_ptp_columns()
BEGIN
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'failover_state'
    ) THEN
        ALTER TABLE network_links DROP COLUMN failover_state;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'is_primary'
    ) THEN
        ALTER TABLE network_links DROP COLUMN is_primary;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'failover_link_id'
    ) THEN
        ALTER TABLE network_links DROP COLUMN failover_link_id;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'link_budget_db'
    ) THEN
        ALTER TABLE network_links DROP COLUMN link_budget_db;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'rx_throughput_mbps'
    ) THEN
        ALTER TABLE network_links DROP COLUMN rx_throughput_mbps;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'tx_throughput_mbps'
    ) THEN
        ALTER TABLE network_links DROP COLUMN tx_throughput_mbps;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'modulation'
    ) THEN
        ALTER TABLE network_links DROP COLUMN modulation;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'rx_signal_dbm'
    ) THEN
        ALTER TABLE network_links DROP COLUMN rx_signal_dbm;
    END IF;

    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'tx_signal_dbm'
    ) THEN
        ALTER TABLE network_links DROP COLUMN tx_signal_dbm;
    END IF;
END$$

DELIMITER ;

CALL _rb282_drop_ptp_columns();
DROP PROCEDURE IF EXISTS _rb282_drop_ptp_columns;
