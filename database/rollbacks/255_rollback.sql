-- =============================================================================
-- Rollback 255: Drop extended SNMP metric columns + remove extended rollup procs
-- =============================================================================
-- Reverses migration 255:
--   1. Drops the 12 new columns from snmp_metrics (INFORMATION_SCHEMA-guarded).
--   2. Drops the 36 new avg/min/max columns from snmp_metrics_1hr.
--   3. Drops the 36 new avg/min/max columns from snmp_metrics_1day.
--   4. Drops the extended snmp_rollup_to_1hr and snmp_rollup_to_1day procedures.
--      The original procedures from schema.sql will be reapplied on fresh install.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop new columns from snmp_metrics
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _rollback_255_drop_snmp_metrics;
DELIMITER $$
CREATE PROCEDURE _rollback_255_drop_snmp_metrics()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'voltage_mv') THEN
    ALTER TABLE snmp_metrics DROP COLUMN voltage_mv;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'temperature_c') THEN
    ALTER TABLE snmp_metrics DROP COLUMN temperature_c;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'fan_speed_rpm') THEN
    ALTER TABLE snmp_metrics DROP COLUMN fan_speed_rpm;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'if_in_discards') THEN
    ALTER TABLE snmp_metrics DROP COLUMN if_in_discards;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'if_out_discards') THEN
    ALTER TABLE snmp_metrics DROP COLUMN if_out_discards;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'sfp_tx_power_dbm') THEN
    ALTER TABLE snmp_metrics DROP COLUMN sfp_tx_power_dbm;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'sfp_rx_power_dbm') THEN
    ALTER TABLE snmp_metrics DROP COLUMN sfp_rx_power_dbm;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'sfp_temperature_c') THEN
    ALTER TABLE snmp_metrics DROP COLUMN sfp_temperature_c;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'ups_battery_pct') THEN
    ALTER TABLE snmp_metrics DROP COLUMN ups_battery_pct;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'ups_runtime_min') THEN
    ALTER TABLE snmp_metrics DROP COLUMN ups_runtime_min;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'poe_power_mw') THEN
    ALTER TABLE snmp_metrics DROP COLUMN poe_power_mw;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics' AND COLUMN_NAME = 'humidity_pct') THEN
    ALTER TABLE snmp_metrics DROP COLUMN humidity_pct;
  END IF;
END$$
DELIMITER ;
CALL _rollback_255_drop_snmp_metrics();
DROP PROCEDURE IF EXISTS _rollback_255_drop_snmp_metrics;

-- ---------------------------------------------------------------------------
-- Drop new columns from snmp_metrics_1hr
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _rollback_255_drop_snmp_metrics_1hr;
DELIMITER $$
CREATE PROCEDURE _rollback_255_drop_snmp_metrics_1hr()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_voltage_mv') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_voltage_mv; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_voltage_mv') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_voltage_mv; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_voltage_mv') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_voltage_mv; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_temperature_c') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_temperature_c') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_temperature_c') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_fan_speed_rpm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_fan_speed_rpm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_fan_speed_rpm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_fan_speed_rpm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_fan_speed_rpm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_fan_speed_rpm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_if_in_discards') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_if_in_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_if_in_discards') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_if_in_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_if_in_discards') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_if_in_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_if_out_discards') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_if_out_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_if_out_discards') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_if_out_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_if_out_discards') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_if_out_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_sfp_tx_power_dbm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_sfp_tx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_sfp_tx_power_dbm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_sfp_tx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_sfp_tx_power_dbm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_sfp_tx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_sfp_rx_power_dbm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_sfp_rx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_sfp_rx_power_dbm' AND TABLE_SCHEMA = DATABASE()) THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_sfp_rx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_sfp_rx_power_dbm') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_sfp_rx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_sfp_temperature_c') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_sfp_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_sfp_temperature_c') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_sfp_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_sfp_temperature_c') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_sfp_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_ups_battery_pct') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_ups_battery_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_ups_battery_pct') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_ups_battery_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_ups_battery_pct') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_ups_battery_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_ups_runtime_min') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_ups_runtime_min; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_ups_runtime_min') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_ups_runtime_min; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_ups_runtime_min') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_ups_runtime_min; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_poe_power_mw') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_poe_power_mw; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_poe_power_mw') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_poe_power_mw; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_poe_power_mw') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_poe_power_mw; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'avg_humidity_pct') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN avg_humidity_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'min_humidity_pct') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN min_humidity_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1hr' AND COLUMN_NAME = 'max_humidity_pct') THEN ALTER TABLE snmp_metrics_1hr DROP COLUMN max_humidity_pct; END IF;
END$$
DELIMITER ;
CALL _rollback_255_drop_snmp_metrics_1hr();
DROP PROCEDURE IF EXISTS _rollback_255_drop_snmp_metrics_1hr;

-- ---------------------------------------------------------------------------
-- Drop new columns from snmp_metrics_1day
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _rollback_255_drop_snmp_metrics_1day;
DELIMITER $$
CREATE PROCEDURE _rollback_255_drop_snmp_metrics_1day()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_voltage_mv') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_voltage_mv; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_voltage_mv') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_voltage_mv; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_voltage_mv') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_voltage_mv; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_temperature_c') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_temperature_c') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_temperature_c') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_fan_speed_rpm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_fan_speed_rpm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_fan_speed_rpm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_fan_speed_rpm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_fan_speed_rpm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_fan_speed_rpm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_if_in_discards') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_if_in_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_if_in_discards') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_if_in_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_if_in_discards') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_if_in_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_if_out_discards') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_if_out_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_if_out_discards') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_if_out_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_if_out_discards') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_if_out_discards; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_sfp_tx_power_dbm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_sfp_tx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_sfp_tx_power_dbm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_sfp_tx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_sfp_tx_power_dbm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_sfp_tx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_sfp_rx_power_dbm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_sfp_rx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_sfp_rx_power_dbm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_sfp_rx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_sfp_rx_power_dbm') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_sfp_rx_power_dbm; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_sfp_temperature_c') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_sfp_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_sfp_temperature_c') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_sfp_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_sfp_temperature_c') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_sfp_temperature_c; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_ups_battery_pct') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_ups_battery_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_ups_battery_pct') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_ups_battery_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_ups_battery_pct') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_ups_battery_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_ups_runtime_min') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_ups_runtime_min; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_ups_runtime_min') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_ups_runtime_min; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_ups_runtime_min') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_ups_runtime_min; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_poe_power_mw') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_poe_power_mw; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_poe_power_mw') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_poe_power_mw; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_poe_power_mw') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_poe_power_mw; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'avg_humidity_pct') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN avg_humidity_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'min_humidity_pct') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN min_humidity_pct; END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'snmp_metrics_1day' AND COLUMN_NAME = 'max_humidity_pct') THEN ALTER TABLE snmp_metrics_1day DROP COLUMN max_humidity_pct; END IF;
END$$
DELIMITER ;
CALL _rollback_255_drop_snmp_metrics_1day();
DROP PROCEDURE IF EXISTS _rollback_255_drop_snmp_metrics_1day;

-- ---------------------------------------------------------------------------
-- Drop the extended rollup procedures.
-- The originals from schema.sql will be recreated on fresh install.
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS snmp_rollup_to_1hr;
DROP PROCEDURE IF EXISTS snmp_rollup_to_1day;
