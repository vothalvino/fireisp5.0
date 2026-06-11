-- =============================================================================
-- Migration 255: Extend SNMP metric columns (voltage, temp, fan, discards, SFP,
--                UPS, PoE, humidity) + rebuild rollup procedures
-- =============================================================================
-- Implements isp-platform-features.md §6.2 "Extended Device Metrics":
--   Part 1: Adds 12 NULL-able metric columns to snmp_metrics (partitioned).
--   Part 2: Adds 36 avg/min/max columns to snmp_metrics_1hr.
--   Part 3: Adds 36 avg/min/max columns to snmp_metrics_1day.
--   Part 4: Replaces snmp_rollup_to_1hr with the extended version.
--   Part 5: Replaces snmp_rollup_to_1day with the extended version.
--
-- All ADD COLUMN operations are guarded with INFORMATION_SCHEMA checks because
-- MySQL 8 has no ADD COLUMN IF NOT EXISTS.
-- snmp_metrics is a PARTITIONED table — no foreign keys; new columns are all
-- NULL so no DEFAULT is required under partition rules.
--
-- Requires:
--   025_create_snmp_metrics_table
--   026_create_snmp_metrics_1hr_table
--   027_create_snmp_metrics_1day_table
--   028_create_snmp_rollup_events
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: snmp_metrics — 12 new nullable columns
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _migration_255_alter_snmp_metrics;
DELIMITER $$
CREATE PROCEDURE _migration_255_alter_snmp_metrics()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'voltage_mv'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN voltage_mv INT NULL
        COMMENT 'Supply voltage in millivolts (e.g. 12000 = 12V)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'temperature_c'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN temperature_c DECIMAL(6,2) NULL
        COMMENT 'Device/sensor temperature in Celsius';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'fan_speed_rpm'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN fan_speed_rpm INT NULL
        COMMENT 'Fan speed in RPM';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'if_in_discards'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN if_in_discards BIGINT NULL
        COMMENT 'ifInDiscards — inbound packets discarded';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'if_out_discards'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN if_out_discards BIGINT NULL
        COMMENT 'ifOutDiscards — outbound packets discarded';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'sfp_tx_power_dbm'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN sfp_tx_power_dbm DECIMAL(8,4) NULL
        COMMENT 'SFP/QSFP Tx optical power in dBm';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'sfp_rx_power_dbm'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN sfp_rx_power_dbm DECIMAL(8,4) NULL
        COMMENT 'SFP/QSFP Rx optical power in dBm';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'sfp_temperature_c'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN sfp_temperature_c DECIMAL(6,2) NULL
        COMMENT 'SFP/QSFP transceiver temperature in Celsius';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'ups_battery_pct'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN ups_battery_pct SMALLINT NULL
        COMMENT 'UPS battery charge percentage';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'ups_runtime_min'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN ups_runtime_min INT NULL
        COMMENT 'UPS estimated runtime remaining in minutes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'poe_power_mw'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN poe_power_mw INT NULL
        COMMENT 'PoE port power draw in milliwatts';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'snmp_metrics'
      AND COLUMN_NAME  = 'humidity_pct'
  ) THEN
    ALTER TABLE snmp_metrics
      ADD COLUMN humidity_pct DECIMAL(5,2) NULL
        COMMENT 'Environmental relative humidity percentage';
  END IF;
END$$
DELIMITER ;
CALL _migration_255_alter_snmp_metrics();
DROP PROCEDURE IF EXISTS _migration_255_alter_snmp_metrics;

-- ---------------------------------------------------------------------------
-- Part 2: snmp_metrics_1hr — 36 new nullable avg/min/max columns
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _migration_255_alter_snmp_metrics_1hr;
DELIMITER $$
CREATE PROCEDURE _migration_255_alter_snmp_metrics_1hr()
BEGIN
  -- voltage_mv
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_voltage_mv') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_voltage_mv DECIMAL(12,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_voltage_mv') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_voltage_mv INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_voltage_mv') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_voltage_mv INT NULL;
  END IF;

  -- temperature_c
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_temperature_c') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_temperature_c DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_temperature_c') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_temperature_c DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_temperature_c') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_temperature_c DECIMAL(6,2) NULL;
  END IF;

  -- fan_speed_rpm
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_fan_speed_rpm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_fan_speed_rpm DECIMAL(10,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_fan_speed_rpm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_fan_speed_rpm INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_fan_speed_rpm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_fan_speed_rpm INT NULL;
  END IF;

  -- if_in_discards
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_if_in_discards') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_if_in_discards DECIMAL(20,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_if_in_discards') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_if_in_discards BIGINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_if_in_discards') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_if_in_discards BIGINT NULL;
  END IF;

  -- if_out_discards
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_if_out_discards') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_if_out_discards DECIMAL(20,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_if_out_discards') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_if_out_discards BIGINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_if_out_discards') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_if_out_discards BIGINT NULL;
  END IF;

  -- sfp_tx_power_dbm
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_sfp_tx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_sfp_tx_power_dbm DECIMAL(10,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_sfp_tx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_sfp_tx_power_dbm DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_sfp_tx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_sfp_tx_power_dbm DECIMAL(8,4) NULL;
  END IF;

  -- sfp_rx_power_dbm
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_sfp_rx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_sfp_rx_power_dbm DECIMAL(10,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_sfp_rx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_sfp_rx_power_dbm DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_sfp_rx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_sfp_rx_power_dbm DECIMAL(8,4) NULL;
  END IF;

  -- sfp_temperature_c
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_sfp_temperature_c') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_sfp_temperature_c DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_sfp_temperature_c') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_sfp_temperature_c DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_sfp_temperature_c') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_sfp_temperature_c DECIMAL(6,2) NULL;
  END IF;

  -- ups_battery_pct
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_ups_battery_pct') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_ups_battery_pct DECIMAL(5,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_ups_battery_pct') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_ups_battery_pct SMALLINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_ups_battery_pct') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_ups_battery_pct SMALLINT NULL;
  END IF;

  -- ups_runtime_min
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_ups_runtime_min') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_ups_runtime_min DECIMAL(10,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_ups_runtime_min') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_ups_runtime_min INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_ups_runtime_min') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_ups_runtime_min INT NULL;
  END IF;

  -- poe_power_mw
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_poe_power_mw') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_poe_power_mw DECIMAL(12,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_poe_power_mw') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_poe_power_mw INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_poe_power_mw') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_poe_power_mw INT NULL;
  END IF;

  -- humidity_pct
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_humidity_pct') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN avg_humidity_pct DECIMAL(7,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_humidity_pct') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN min_humidity_pct DECIMAL(5,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_humidity_pct') THEN
    ALTER TABLE snmp_metrics_1hr ADD COLUMN max_humidity_pct DECIMAL(5,2) NULL;
  END IF;
END$$
DELIMITER ;
CALL _migration_255_alter_snmp_metrics_1hr();
DROP PROCEDURE IF EXISTS _migration_255_alter_snmp_metrics_1hr;

-- ---------------------------------------------------------------------------
-- Part 3: snmp_metrics_1day — 36 new nullable avg/min/max columns
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _migration_255_alter_snmp_metrics_1day;
DELIMITER $$
CREATE PROCEDURE _migration_255_alter_snmp_metrics_1day()
BEGIN
  -- voltage_mv
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_voltage_mv') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_voltage_mv DECIMAL(12,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_voltage_mv') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_voltage_mv INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_voltage_mv') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_voltage_mv INT NULL;
  END IF;

  -- temperature_c
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_temperature_c') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_temperature_c DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_temperature_c') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_temperature_c DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_temperature_c') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_temperature_c DECIMAL(6,2) NULL;
  END IF;

  -- fan_speed_rpm
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_fan_speed_rpm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_fan_speed_rpm DECIMAL(10,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_fan_speed_rpm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_fan_speed_rpm INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_fan_speed_rpm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_fan_speed_rpm INT NULL;
  END IF;

  -- if_in_discards
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_if_in_discards') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_if_in_discards DECIMAL(20,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_if_in_discards') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_if_in_discards BIGINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_if_in_discards') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_if_in_discards BIGINT NULL;
  END IF;

  -- if_out_discards
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_if_out_discards') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_if_out_discards DECIMAL(20,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_if_out_discards') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_if_out_discards BIGINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_if_out_discards') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_if_out_discards BIGINT NULL;
  END IF;

  -- sfp_tx_power_dbm
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_sfp_tx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_sfp_tx_power_dbm DECIMAL(10,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_sfp_tx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_sfp_tx_power_dbm DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_sfp_tx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_sfp_tx_power_dbm DECIMAL(8,4) NULL;
  END IF;

  -- sfp_rx_power_dbm
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_sfp_rx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_sfp_rx_power_dbm DECIMAL(10,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_sfp_rx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_sfp_rx_power_dbm DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_sfp_rx_power_dbm') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_sfp_rx_power_dbm DECIMAL(8,4) NULL;
  END IF;

  -- sfp_temperature_c
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_sfp_temperature_c') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_sfp_temperature_c DECIMAL(8,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_sfp_temperature_c') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_sfp_temperature_c DECIMAL(6,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_sfp_temperature_c') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_sfp_temperature_c DECIMAL(6,2) NULL;
  END IF;

  -- ups_battery_pct
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_ups_battery_pct') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_ups_battery_pct DECIMAL(5,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_ups_battery_pct') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_ups_battery_pct SMALLINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_ups_battery_pct') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_ups_battery_pct SMALLINT NULL;
  END IF;

  -- ups_runtime_min
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_ups_runtime_min') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_ups_runtime_min DECIMAL(10,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_ups_runtime_min') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_ups_runtime_min INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_ups_runtime_min') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_ups_runtime_min INT NULL;
  END IF;

  -- poe_power_mw
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_poe_power_mw') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_poe_power_mw DECIMAL(12,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_poe_power_mw') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_poe_power_mw INT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_poe_power_mw') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_poe_power_mw INT NULL;
  END IF;

  -- humidity_pct
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_humidity_pct') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN avg_humidity_pct DECIMAL(7,4) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_humidity_pct') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN min_humidity_pct DECIMAL(5,2) NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_humidity_pct') THEN
    ALTER TABLE snmp_metrics_1day ADD COLUMN max_humidity_pct DECIMAL(5,2) NULL;
  END IF;
END$$
DELIMITER ;
CALL _migration_255_alter_snmp_metrics_1day();
DROP PROCEDURE IF EXISTS _migration_255_alter_snmp_metrics_1day;

-- ---------------------------------------------------------------------------
-- Part 4: Replace snmp_rollup_to_1hr (DROP + CREATE) with extended columns
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS snmp_rollup_to_1hr;
DELIMITER $$
CREATE PROCEDURE snmp_rollup_to_1hr()
proc: BEGIN
    DECLARE v_from_ts TIMESTAMP;
    DECLARE v_to_ts   TIMESTAMP;

    SELECT COALESCE(last_processed, DATE_SUB(NOW(), INTERVAL 90 DAY))
    INTO v_from_ts
    FROM snmp_rollup_state
    WHERE rollup_name = '1hr';

    SET v_to_ts = DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00');

    IF v_from_ts >= v_to_ts THEN
        LEAVE proc;
    END IF;

    INSERT INTO snmp_metrics_1hr
        (device_id, interface_id, period_start,
         avg_if_in_octets,       min_if_in_octets,       max_if_in_octets,
         avg_if_out_octets,      min_if_out_octets,      max_if_out_octets,
         avg_if_in_errors,       min_if_in_errors,       max_if_in_errors,
         avg_if_out_errors,      min_if_out_errors,      max_if_out_errors,
         avg_cpu_usage,          min_cpu_usage,           max_cpu_usage,
         avg_memory_usage,       min_memory_usage,        max_memory_usage,
         avg_signal_strength,    min_signal_strength,     max_signal_strength,
         avg_latency_ms,         min_latency_ms,          max_latency_ms,
         avg_voltage_mv,         min_voltage_mv,          max_voltage_mv,
         avg_temperature_c,      min_temperature_c,       max_temperature_c,
         avg_fan_speed_rpm,      min_fan_speed_rpm,       max_fan_speed_rpm,
         avg_if_in_discards,     min_if_in_discards,      max_if_in_discards,
         avg_if_out_discards,    min_if_out_discards,     max_if_out_discards,
         avg_sfp_tx_power_dbm,   min_sfp_tx_power_dbm,   max_sfp_tx_power_dbm,
         avg_sfp_rx_power_dbm,   min_sfp_rx_power_dbm,   max_sfp_rx_power_dbm,
         avg_sfp_temperature_c,  min_sfp_temperature_c,  max_sfp_temperature_c,
         avg_ups_battery_pct,    min_ups_battery_pct,     max_ups_battery_pct,
         avg_ups_runtime_min,    min_ups_runtime_min,     max_ups_runtime_min,
         avg_poe_power_mw,       min_poe_power_mw,        max_poe_power_mw,
         avg_humidity_pct,       min_humidity_pct,        max_humidity_pct,
         sample_count)
    SELECT
        device_id,
        COALESCE(interface_id, '')                        AS interface_id,
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')       AS period_start,
        AVG(if_in_octets),       MIN(if_in_octets),       MAX(if_in_octets),
        AVG(if_out_octets),      MIN(if_out_octets),      MAX(if_out_octets),
        AVG(if_in_errors),       MIN(if_in_errors),       MAX(if_in_errors),
        AVG(if_out_errors),      MIN(if_out_errors),      MAX(if_out_errors),
        AVG(cpu_usage),          MIN(cpu_usage),           MAX(cpu_usage),
        AVG(memory_usage),       MIN(memory_usage),        MAX(memory_usage),
        AVG(signal_strength),    MIN(signal_strength),     MAX(signal_strength),
        AVG(latency_ms),         MIN(latency_ms),          MAX(latency_ms),
        AVG(voltage_mv),         MIN(voltage_mv),          MAX(voltage_mv),
        AVG(temperature_c),      MIN(temperature_c),       MAX(temperature_c),
        AVG(fan_speed_rpm),      MIN(fan_speed_rpm),       MAX(fan_speed_rpm),
        AVG(if_in_discards),     MIN(if_in_discards),      MAX(if_in_discards),
        AVG(if_out_discards),    MIN(if_out_discards),     MAX(if_out_discards),
        AVG(sfp_tx_power_dbm),   MIN(sfp_tx_power_dbm),   MAX(sfp_tx_power_dbm),
        AVG(sfp_rx_power_dbm),   MIN(sfp_rx_power_dbm),   MAX(sfp_rx_power_dbm),
        AVG(sfp_temperature_c),  MIN(sfp_temperature_c),  MAX(sfp_temperature_c),
        AVG(ups_battery_pct),    MIN(ups_battery_pct),     MAX(ups_battery_pct),
        AVG(ups_runtime_min),    MIN(ups_runtime_min),     MAX(ups_runtime_min),
        AVG(poe_power_mw),       MIN(poe_power_mw),        MAX(poe_power_mw),
        AVG(humidity_pct),       MIN(humidity_pct),        MAX(humidity_pct),
        COUNT(*)
    FROM snmp_metrics
    WHERE polled_at >  v_from_ts
      AND polled_at <  v_to_ts
    GROUP BY
        device_id,
        COALESCE(interface_id, ''),
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets       = VALUES(avg_if_in_octets),
        min_if_in_octets       = VALUES(min_if_in_octets),
        max_if_in_octets       = VALUES(max_if_in_octets),
        avg_if_out_octets      = VALUES(avg_if_out_octets),
        min_if_out_octets      = VALUES(min_if_out_octets),
        max_if_out_octets      = VALUES(max_if_out_octets),
        avg_if_in_errors       = VALUES(avg_if_in_errors),
        min_if_in_errors       = VALUES(min_if_in_errors),
        max_if_in_errors       = VALUES(max_if_in_errors),
        avg_if_out_errors      = VALUES(avg_if_out_errors),
        min_if_out_errors      = VALUES(min_if_out_errors),
        max_if_out_errors      = VALUES(max_if_out_errors),
        avg_cpu_usage          = VALUES(avg_cpu_usage),
        min_cpu_usage          = VALUES(min_cpu_usage),
        max_cpu_usage          = VALUES(max_cpu_usage),
        avg_memory_usage       = VALUES(avg_memory_usage),
        min_memory_usage       = VALUES(min_memory_usage),
        max_memory_usage       = VALUES(max_memory_usage),
        avg_signal_strength    = VALUES(avg_signal_strength),
        min_signal_strength    = VALUES(min_signal_strength),
        max_signal_strength    = VALUES(max_signal_strength),
        avg_latency_ms         = VALUES(avg_latency_ms),
        min_latency_ms         = VALUES(min_latency_ms),
        max_latency_ms         = VALUES(max_latency_ms),
        avg_voltage_mv         = VALUES(avg_voltage_mv),
        min_voltage_mv         = VALUES(min_voltage_mv),
        max_voltage_mv         = VALUES(max_voltage_mv),
        avg_temperature_c      = VALUES(avg_temperature_c),
        min_temperature_c      = VALUES(min_temperature_c),
        max_temperature_c      = VALUES(max_temperature_c),
        avg_fan_speed_rpm      = VALUES(avg_fan_speed_rpm),
        min_fan_speed_rpm      = VALUES(min_fan_speed_rpm),
        max_fan_speed_rpm      = VALUES(max_fan_speed_rpm),
        avg_if_in_discards     = VALUES(avg_if_in_discards),
        min_if_in_discards     = VALUES(min_if_in_discards),
        max_if_in_discards     = VALUES(max_if_in_discards),
        avg_if_out_discards    = VALUES(avg_if_out_discards),
        min_if_out_discards    = VALUES(min_if_out_discards),
        max_if_out_discards    = VALUES(max_if_out_discards),
        avg_sfp_tx_power_dbm   = VALUES(avg_sfp_tx_power_dbm),
        min_sfp_tx_power_dbm   = VALUES(min_sfp_tx_power_dbm),
        max_sfp_tx_power_dbm   = VALUES(max_sfp_tx_power_dbm),
        avg_sfp_rx_power_dbm   = VALUES(avg_sfp_rx_power_dbm),
        min_sfp_rx_power_dbm   = VALUES(min_sfp_rx_power_dbm),
        max_sfp_rx_power_dbm   = VALUES(max_sfp_rx_power_dbm),
        avg_sfp_temperature_c  = VALUES(avg_sfp_temperature_c),
        min_sfp_temperature_c  = VALUES(min_sfp_temperature_c),
        max_sfp_temperature_c  = VALUES(max_sfp_temperature_c),
        avg_ups_battery_pct    = VALUES(avg_ups_battery_pct),
        min_ups_battery_pct    = VALUES(min_ups_battery_pct),
        max_ups_battery_pct    = VALUES(max_ups_battery_pct),
        avg_ups_runtime_min    = VALUES(avg_ups_runtime_min),
        min_ups_runtime_min    = VALUES(min_ups_runtime_min),
        max_ups_runtime_min    = VALUES(max_ups_runtime_min),
        avg_poe_power_mw       = VALUES(avg_poe_power_mw),
        min_poe_power_mw       = VALUES(min_poe_power_mw),
        max_poe_power_mw       = VALUES(max_poe_power_mw),
        avg_humidity_pct       = VALUES(avg_humidity_pct),
        min_humidity_pct       = VALUES(min_humidity_pct),
        max_humidity_pct       = VALUES(max_humidity_pct),
        sample_count           = VALUES(sample_count);

    UPDATE snmp_rollup_state
    SET last_processed = v_to_ts
    WHERE rollup_name  = '1hr';
END$$
DELIMITER ;

-- ---------------------------------------------------------------------------
-- Part 5: Replace snmp_rollup_to_1day (DROP + CREATE) with extended columns
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS snmp_rollup_to_1day;
DELIMITER $$
CREATE PROCEDURE snmp_rollup_to_1day()
proc: BEGIN
    DECLARE v_from_date DATE;
    DECLARE v_to_date   DATE;

    SELECT COALESCE(DATE(last_processed), DATE_SUB(CURDATE(), INTERVAL 1 YEAR))
    INTO v_from_date
    FROM snmp_rollup_state
    WHERE rollup_name = '1day';

    SET v_to_date = CURDATE();

    IF v_from_date >= v_to_date THEN
        LEAVE proc;
    END IF;

    INSERT INTO snmp_metrics_1day
        (device_id, interface_id, period_start,
         avg_if_in_octets,       min_if_in_octets,       max_if_in_octets,
         avg_if_out_octets,      min_if_out_octets,      max_if_out_octets,
         avg_if_in_errors,       min_if_in_errors,       max_if_in_errors,
         avg_if_out_errors,      min_if_out_errors,      max_if_out_errors,
         avg_cpu_usage,          min_cpu_usage,           max_cpu_usage,
         avg_memory_usage,       min_memory_usage,        max_memory_usage,
         avg_signal_strength,    min_signal_strength,     max_signal_strength,
         avg_latency_ms,         min_latency_ms,          max_latency_ms,
         avg_voltage_mv,         min_voltage_mv,          max_voltage_mv,
         avg_temperature_c,      min_temperature_c,       max_temperature_c,
         avg_fan_speed_rpm,      min_fan_speed_rpm,       max_fan_speed_rpm,
         avg_if_in_discards,     min_if_in_discards,      max_if_in_discards,
         avg_if_out_discards,    min_if_out_discards,     max_if_out_discards,
         avg_sfp_tx_power_dbm,   min_sfp_tx_power_dbm,   max_sfp_tx_power_dbm,
         avg_sfp_rx_power_dbm,   min_sfp_rx_power_dbm,   max_sfp_rx_power_dbm,
         avg_sfp_temperature_c,  min_sfp_temperature_c,  max_sfp_temperature_c,
         avg_ups_battery_pct,    min_ups_battery_pct,     max_ups_battery_pct,
         avg_ups_runtime_min,    min_ups_runtime_min,     max_ups_runtime_min,
         avg_poe_power_mw,       min_poe_power_mw,        max_poe_power_mw,
         avg_humidity_pct,       min_humidity_pct,        max_humidity_pct,
         sample_count)
    SELECT
        device_id,
        interface_id,
        DATE(period_start)                                     AS period_start,
        AVG(avg_if_in_octets),       MIN(min_if_in_octets),       MAX(max_if_in_octets),
        AVG(avg_if_out_octets),      MIN(min_if_out_octets),      MAX(max_if_out_octets),
        AVG(avg_if_in_errors),       MIN(min_if_in_errors),       MAX(max_if_in_errors),
        AVG(avg_if_out_errors),      MIN(min_if_out_errors),      MAX(max_if_out_errors),
        AVG(avg_cpu_usage),          MIN(min_cpu_usage),           MAX(max_cpu_usage),
        AVG(avg_memory_usage),       MIN(min_memory_usage),        MAX(max_memory_usage),
        AVG(avg_signal_strength),    MIN(min_signal_strength),     MAX(max_signal_strength),
        AVG(avg_latency_ms),         MIN(min_latency_ms),          MAX(max_latency_ms),
        AVG(avg_voltage_mv),         MIN(min_voltage_mv),          MAX(max_voltage_mv),
        AVG(avg_temperature_c),      MIN(min_temperature_c),       MAX(max_temperature_c),
        AVG(avg_fan_speed_rpm),      MIN(min_fan_speed_rpm),       MAX(max_fan_speed_rpm),
        AVG(avg_if_in_discards),     MIN(min_if_in_discards),      MAX(max_if_in_discards),
        AVG(avg_if_out_discards),    MIN(min_if_out_discards),     MAX(max_if_out_discards),
        AVG(avg_sfp_tx_power_dbm),   MIN(min_sfp_tx_power_dbm),   MAX(max_sfp_tx_power_dbm),
        AVG(avg_sfp_rx_power_dbm),   MIN(min_sfp_rx_power_dbm),   MAX(max_sfp_rx_power_dbm),
        AVG(avg_sfp_temperature_c),  MIN(min_sfp_temperature_c),  MAX(max_sfp_temperature_c),
        AVG(avg_ups_battery_pct),    MIN(min_ups_battery_pct),     MAX(max_ups_battery_pct),
        AVG(avg_ups_runtime_min),    MIN(min_ups_runtime_min),     MAX(max_ups_runtime_min),
        AVG(avg_poe_power_mw),       MIN(min_poe_power_mw),        MAX(max_poe_power_mw),
        AVG(avg_humidity_pct),       MIN(min_humidity_pct),        MAX(max_humidity_pct),
        SUM(sample_count)
    FROM snmp_metrics_1hr
    WHERE period_start >= v_from_date
      AND period_start <  v_to_date
    GROUP BY device_id, interface_id, DATE(period_start)
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets       = VALUES(avg_if_in_octets),
        min_if_in_octets       = VALUES(min_if_in_octets),
        max_if_in_octets       = VALUES(max_if_in_octets),
        avg_if_out_octets      = VALUES(avg_if_out_octets),
        min_if_out_octets      = VALUES(min_if_out_octets),
        max_if_out_octets      = VALUES(max_if_out_octets),
        avg_if_in_errors       = VALUES(avg_if_in_errors),
        min_if_in_errors       = VALUES(min_if_in_errors),
        max_if_in_errors       = VALUES(max_if_in_errors),
        avg_if_out_errors      = VALUES(avg_if_out_errors),
        min_if_out_errors      = VALUES(min_if_out_errors),
        max_if_out_errors      = VALUES(max_if_out_errors),
        avg_cpu_usage          = VALUES(avg_cpu_usage),
        min_cpu_usage          = VALUES(min_cpu_usage),
        max_cpu_usage          = VALUES(max_cpu_usage),
        avg_memory_usage       = VALUES(avg_memory_usage),
        min_memory_usage       = VALUES(min_memory_usage),
        max_memory_usage       = VALUES(max_memory_usage),
        avg_signal_strength    = VALUES(avg_signal_strength),
        min_signal_strength    = VALUES(min_signal_strength),
        max_signal_strength    = VALUES(max_signal_strength),
        avg_latency_ms         = VALUES(avg_latency_ms),
        min_latency_ms         = VALUES(min_latency_ms),
        max_latency_ms         = VALUES(max_latency_ms),
        avg_voltage_mv         = VALUES(avg_voltage_mv),
        min_voltage_mv         = VALUES(min_voltage_mv),
        max_voltage_mv         = VALUES(max_voltage_mv),
        avg_temperature_c      = VALUES(avg_temperature_c),
        min_temperature_c      = VALUES(min_temperature_c),
        max_temperature_c      = VALUES(max_temperature_c),
        avg_fan_speed_rpm      = VALUES(avg_fan_speed_rpm),
        min_fan_speed_rpm      = VALUES(min_fan_speed_rpm),
        max_fan_speed_rpm      = VALUES(max_fan_speed_rpm),
        avg_if_in_discards     = VALUES(avg_if_in_discards),
        min_if_in_discards     = VALUES(min_if_in_discards),
        max_if_in_discards     = VALUES(max_if_in_discards),
        avg_if_out_discards    = VALUES(avg_if_out_discards),
        min_if_out_discards    = VALUES(min_if_out_discards),
        max_if_out_discards    = VALUES(max_if_out_discards),
        avg_sfp_tx_power_dbm   = VALUES(avg_sfp_tx_power_dbm),
        min_sfp_tx_power_dbm   = VALUES(min_sfp_tx_power_dbm),
        max_sfp_tx_power_dbm   = VALUES(max_sfp_tx_power_dbm),
        avg_sfp_rx_power_dbm   = VALUES(avg_sfp_rx_power_dbm),
        min_sfp_rx_power_dbm   = VALUES(min_sfp_rx_power_dbm),
        max_sfp_rx_power_dbm   = VALUES(max_sfp_rx_power_dbm),
        avg_sfp_temperature_c  = VALUES(avg_sfp_temperature_c),
        min_sfp_temperature_c  = VALUES(min_sfp_temperature_c),
        max_sfp_temperature_c  = VALUES(max_sfp_temperature_c),
        avg_ups_battery_pct    = VALUES(avg_ups_battery_pct),
        min_ups_battery_pct    = VALUES(min_ups_battery_pct),
        max_ups_battery_pct    = VALUES(max_ups_battery_pct),
        avg_ups_runtime_min    = VALUES(avg_ups_runtime_min),
        min_ups_runtime_min    = VALUES(min_ups_runtime_min),
        max_ups_runtime_min    = VALUES(max_ups_runtime_min),
        avg_poe_power_mw       = VALUES(avg_poe_power_mw),
        min_poe_power_mw       = VALUES(min_poe_power_mw),
        max_poe_power_mw       = VALUES(max_poe_power_mw),
        avg_humidity_pct       = VALUES(avg_humidity_pct),
        min_humidity_pct       = VALUES(min_humidity_pct),
        max_humidity_pct       = VALUES(max_humidity_pct),
        sample_count           = VALUES(sample_count);

    UPDATE snmp_rollup_state
    SET last_processed = TIMESTAMP(v_to_date)
    WHERE rollup_name  = '1day';
END$$
DELIMITER ;

-- END OF MIGRATION 255
