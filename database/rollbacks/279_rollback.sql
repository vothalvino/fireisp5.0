-- =============================================================================
-- Rollback 279: Drop §9.1 Wireless AP Sector Tables
-- =============================================================================
-- Reverses migration 279.
-- Run this BEFORE rolling back migrations that these tables depend on.
-- Drops tables in reverse FK dependency order:
--   wireless_channel_interference → ap_sector_configs → ap_channel_plans
--   wireless_client_sessions, ap_command_jobs
-- Also removes RF metric columns added to snmp_metrics rollup tables.
-- =============================================================================

DROP TABLE IF EXISTS wireless_channel_interference;
DROP TABLE IF EXISTS ap_command_jobs;
DROP TABLE IF EXISTS wireless_client_sessions;
DROP TABLE IF EXISTS ap_sector_configs;
DROP TABLE IF EXISTS ap_channel_plans;

-- Remove RF metric columns from snmp_metrics
-- (MySQL does not support IF EXISTS on ALTER TABLE DROP COLUMN in 8.0,
--  so we use a guarded procedure)

DROP PROCEDURE IF EXISTS rollback_279_drop_rf_metrics;
DELIMITER $$
CREATE PROCEDURE rollback_279_drop_rf_metrics()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics
      DROP COLUMN noise_floor_dbm,
      DROP COLUMN air_util_pct,
      DROP COLUMN gps_sync_status,
      DROP COLUMN snr_db,
      DROP COLUMN ccq_pct,
      DROP COLUMN tx_rate_mbps,
      DROP COLUMN rx_rate_mbps;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1hr'
      AND COLUMN_NAME  = 'avg_noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics_1hr
      DROP COLUMN avg_noise_floor_dbm,
      DROP COLUMN min_noise_floor_dbm,
      DROP COLUMN max_noise_floor_dbm,
      DROP COLUMN avg_air_util_pct,
      DROP COLUMN min_air_util_pct,
      DROP COLUMN max_air_util_pct,
      DROP COLUMN avg_gps_sync_status,
      DROP COLUMN min_gps_sync_status,
      DROP COLUMN max_gps_sync_status,
      DROP COLUMN avg_snr_db,
      DROP COLUMN min_snr_db,
      DROP COLUMN max_snr_db,
      DROP COLUMN avg_ccq_pct,
      DROP COLUMN min_ccq_pct,
      DROP COLUMN max_ccq_pct,
      DROP COLUMN avg_tx_rate_mbps,
      DROP COLUMN min_tx_rate_mbps,
      DROP COLUMN max_tx_rate_mbps,
      DROP COLUMN avg_rx_rate_mbps,
      DROP COLUMN min_rx_rate_mbps,
      DROP COLUMN max_rx_rate_mbps;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1day'
      AND COLUMN_NAME  = 'avg_noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics_1day
      DROP COLUMN avg_noise_floor_dbm,
      DROP COLUMN min_noise_floor_dbm,
      DROP COLUMN max_noise_floor_dbm,
      DROP COLUMN avg_air_util_pct,
      DROP COLUMN min_air_util_pct,
      DROP COLUMN max_air_util_pct,
      DROP COLUMN avg_gps_sync_status,
      DROP COLUMN min_gps_sync_status,
      DROP COLUMN max_gps_sync_status,
      DROP COLUMN avg_snr_db,
      DROP COLUMN min_snr_db,
      DROP COLUMN max_snr_db,
      DROP COLUMN avg_ccq_pct,
      DROP COLUMN min_ccq_pct,
      DROP COLUMN max_ccq_pct,
      DROP COLUMN avg_tx_rate_mbps,
      DROP COLUMN min_tx_rate_mbps,
      DROP COLUMN max_tx_rate_mbps,
      DROP COLUMN avg_rx_rate_mbps,
      DROP COLUMN min_rx_rate_mbps,
      DROP COLUMN max_rx_rate_mbps;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics_1month'
      AND COLUMN_NAME  = 'avg_noise_floor_dbm'
  ) THEN
    ALTER TABLE snmp_metrics_1month
      DROP COLUMN avg_noise_floor_dbm,
      DROP COLUMN min_noise_floor_dbm,
      DROP COLUMN max_noise_floor_dbm,
      DROP COLUMN avg_air_util_pct,
      DROP COLUMN min_air_util_pct,
      DROP COLUMN max_air_util_pct,
      DROP COLUMN avg_gps_sync_status,
      DROP COLUMN min_gps_sync_status,
      DROP COLUMN max_gps_sync_status,
      DROP COLUMN avg_snr_db,
      DROP COLUMN min_snr_db,
      DROP COLUMN max_snr_db,
      DROP COLUMN avg_ccq_pct,
      DROP COLUMN min_ccq_pct,
      DROP COLUMN max_ccq_pct,
      DROP COLUMN avg_tx_rate_mbps,
      DROP COLUMN min_tx_rate_mbps,
      DROP COLUMN max_tx_rate_mbps,
      DROP COLUMN avg_rx_rate_mbps,
      DROP COLUMN min_rx_rate_mbps,
      DROP COLUMN max_rx_rate_mbps;
  END IF;
END$$
DELIMITER ;

CALL rollback_279_drop_rf_metrics();
DROP PROCEDURE IF EXISTS rollback_279_drop_rf_metrics;
