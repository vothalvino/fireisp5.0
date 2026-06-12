-- =============================================================================
-- Migration 282: PTP Link Extensions + Link Planning Calculator Table
-- =============================================================================
-- Adds PTP/wireless monitoring columns to network_links via guarded stored
-- procedure; creates link_planning_calcs table for saved link budget runs.
--
-- New columns on network_links (added AFTER capacity_mbps):
--   tx_signal_dbm, rx_signal_dbm, modulation, tx_throughput_mbps,
--   rx_throughput_mbps, link_budget_db, failover_link_id, is_primary,
--   failover_state
--
-- New table:
--   link_planning_calcs — saved link budget calculator runs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Add PTP columns to network_links via guarded stored procedure
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _mig282_ptp_extensions;

DELIMITER $$

CREATE PROCEDURE _mig282_ptp_extensions()
BEGIN
    -- tx_signal_dbm
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'tx_signal_dbm'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN tx_signal_dbm DECIMAL(7,2) NULL
                COMMENT 'Tx signal strength in dBm (PTP/wireless links)'
                AFTER capacity_mbps;
    END IF;

    -- rx_signal_dbm
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'rx_signal_dbm'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN rx_signal_dbm DECIMAL(7,2) NULL
                COMMENT 'Rx signal strength in dBm (PTP/wireless links)'
                AFTER tx_signal_dbm;
    END IF;

    -- modulation
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'modulation'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN modulation VARCHAR(50) NULL
                COMMENT 'Modulation mode e.g. QPSK, 16QAM, 64QAM, 256QAM, 1024QAM'
                AFTER rx_signal_dbm;
    END IF;

    -- tx_throughput_mbps
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'tx_throughput_mbps'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN tx_throughput_mbps DECIMAL(10,3) NULL
                COMMENT 'Current Tx throughput in Mbps'
                AFTER modulation;
    END IF;

    -- rx_throughput_mbps
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'rx_throughput_mbps'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN rx_throughput_mbps DECIMAL(10,3) NULL
                COMMENT 'Current Rx throughput in Mbps'
                AFTER tx_throughput_mbps;
    END IF;

    -- link_budget_db
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'link_budget_db'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN link_budget_db DECIMAL(7,2) NULL
                COMMENT 'Calculated link budget in dB (FSPL - losses + Tx power + gain)'
                AFTER rx_throughput_mbps;
    END IF;

    -- failover_link_id (no FK — self-ref can cause issues)
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'failover_link_id'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN failover_link_id BIGINT UNSIGNED NULL
                COMMENT 'FK to network_links — backup link for failover (no FK constraint — self-ref)'
                AFTER link_budget_db;
    END IF;

    -- is_primary
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'is_primary'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 1
                COMMENT '1=primary link, 0=backup/failover link'
                AFTER failover_link_id;
    END IF;

    -- failover_state
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME   = 'network_links'
          AND COLUMN_NAME  = 'failover_state'
    ) THEN
        ALTER TABLE network_links
            ADD COLUMN failover_state ENUM('normal','failed_over','recovering') NOT NULL DEFAULT 'normal'
                AFTER is_primary;
    END IF;
END$$

DELIMITER ;

CALL _mig282_ptp_extensions();
DROP PROCEDURE IF EXISTS _mig282_ptp_extensions;

-- ---------------------------------------------------------------------------
-- Part 2: Create link_planning_calcs table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS link_planning_calcs (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    name                VARCHAR(100)    NOT NULL,
    site_a_id           BIGINT UNSIGNED NULL     COMMENT 'FK to sites (site A endpoint)',
    site_b_id           BIGINT UNSIGNED NULL     COMMENT 'FK to sites (site B endpoint)',
    -- Override coordinates (if sites not selected)
    lat_a               DECIMAL(10,8)   NULL,
    lon_a               DECIMAL(11,8)   NULL,
    lat_b               DECIMAL(10,8)   NULL,
    lon_b               DECIMAL(11,8)   NULL,
    frequency_mhz       INT             NOT NULL COMMENT 'Operating frequency in MHz',
    tx_power_dbm        DECIMAL(6,2)    NULL,
    antenna_gain_a_dbi  DECIMAL(5,2)    NULL,
    antenna_gain_b_dbi  DECIMAL(5,2)    NULL,
    cable_loss_db       DECIMAL(5,2)    NULL DEFAULT 0,
    -- Computed results (stored so we can display history)
    distance_km         DECIMAL(10,4)   NULL COMMENT 'Great-circle distance in km',
    fspl_db             DECIMAL(8,4)    NULL COMMENT 'Free-space path loss in dB',
    fresnel_radius_m    DECIMAL(8,4)    NULL COMMENT 'First Fresnel zone radius at midpoint in metres',
    clearance_required_m DECIMAL(8,4)  NULL COMMENT '0.6 * first Fresnel zone radius (minimum clearance)',
    link_budget_db      DECIMAL(8,4)    NULL COMMENT 'Estimated link budget = TxPower + GainA + GainB - FSPL - CableLoss',
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        DEFAULT NULL,
    PRIMARY KEY (id),
    KEY idx_link_planning_calcs_org (organization_id),
    KEY idx_link_planning_calcs_deleted_at (deleted_at),
    CONSTRAINT fk_lpc_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_lpc_site_a FOREIGN KEY (site_a_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_lpc_site_b FOREIGN KEY (site_b_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Saved link budget calculator runs with computed FSPL, Fresnel zone, and link budget (§9.2)';
