-- =============================================================================
-- Migration 265: Graph retention — hourly 7d, daily 90d, monthly 3yr
-- =============================================================================
-- Implements isp-platform-features.md §6.3 "Graph retention":
--   hourly (7 days), daily (90 days), monthly (3 years)
--
-- Prior state (migration 028):
--   snmp_metrics     (raw)    — 90 days via partition DROP (unchanged)
--   snmp_metrics_1hr (hourly) — 1 year via batch DELETE in snmp_apply_retention()
--   snmp_metrics_1day(daily)  — kept indefinitely
--   snmp_metrics_1month       — did not exist
--
-- This migration:
--   1. Creates snmp_metrics_1month table (monthly aggregates, wide-table like
--      1day/1hr, all columns from migration 264 inclusive).
--   2. Seeds snmp_rollup_state row for '1month'.
--   3. Recreates snmp_apply_retention() with correct retention thresholds:
--        1hr  rows older than  7 days (was: 1 year)
--        1day rows older than 90 days (was: never)
--        1month rows older than 3 years (new)
--   4. Creates snmp_rollup_to_1month() procedure — aggregates daily rows into
--      monthly rows using the high-watermark in snmp_rollup_state.
--   5. Adds/replaces evt_snmp_rollup_1month and evt_snmp_retention events.
--
-- All procedures use DROP PROCEDURE IF EXISTS + CREATE for idempotency.
-- Retention procedure uses batch-DELETE LIMIT 10000 loops (these tables are
-- not partitioned — partition DROP is only used for raw snmp_metrics).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Part 1: Create snmp_metrics_1month
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_metrics_1month (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    device_id           BIGINT UNSIGNED NOT NULL,
    interface_id        VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'SNMP ifIndex or ifDescr; empty string for device-level metrics',
    period_start        DATE            NOT NULL             COMMENT 'First day of the monthly aggregation window (e.g. 2026-06-01)',
    avg_if_in_octets    DECIMAL(20,4)   NULL,
    min_if_in_octets    BIGINT          NULL,
    max_if_in_octets    BIGINT          NULL,
    avg_if_out_octets   DECIMAL(20,4)   NULL,
    min_if_out_octets   BIGINT          NULL,
    max_if_out_octets   BIGINT          NULL,
    avg_if_in_errors    DECIMAL(20,4)   NULL,
    min_if_in_errors    BIGINT          NULL,
    max_if_in_errors    BIGINT          NULL,
    avg_if_out_errors   DECIMAL(20,4)   NULL,
    min_if_out_errors   BIGINT          NULL,
    max_if_out_errors   BIGINT          NULL,
    avg_cpu_usage       DECIMAL(5,2)    NULL,
    min_cpu_usage       SMALLINT        NULL,
    max_cpu_usage       SMALLINT        NULL,
    avg_memory_usage    DECIMAL(5,2)    NULL,
    min_memory_usage    SMALLINT        NULL,
    max_memory_usage    SMALLINT        NULL,
    avg_signal_strength DECIMAL(7,2)    NULL,
    min_signal_strength INTEGER         NULL,
    max_signal_strength INTEGER         NULL,
    avg_latency_ms      DECIMAL(10,2)   NULL,
    min_latency_ms      DECIMAL(10,2)   NULL,
    max_latency_ms      DECIMAL(10,2)   NULL,
    avg_voltage_mv      DECIMAL(12,4)   NULL,
    min_voltage_mv      INT             NULL,
    max_voltage_mv      INT             NULL,
    avg_temperature_c   DECIMAL(8,4)    NULL,
    min_temperature_c   DECIMAL(6,2)    NULL,
    max_temperature_c   DECIMAL(6,2)    NULL,
    avg_fan_speed_rpm   DECIMAL(10,2)   NULL,
    min_fan_speed_rpm   INT             NULL,
    max_fan_speed_rpm   INT             NULL,
    avg_if_in_discards  DECIMAL(20,4)   NULL,
    min_if_in_discards  BIGINT          NULL,
    max_if_in_discards  BIGINT          NULL,
    avg_if_out_discards DECIMAL(20,4)   NULL,
    min_if_out_discards BIGINT          NULL,
    max_if_out_discards BIGINT          NULL,
    avg_sfp_tx_power_dbm DECIMAL(10,4)  NULL,
    min_sfp_tx_power_dbm DECIMAL(8,4)   NULL,
    max_sfp_tx_power_dbm DECIMAL(8,4)   NULL,
    avg_sfp_rx_power_dbm DECIMAL(10,4)  NULL,
    min_sfp_rx_power_dbm DECIMAL(8,4)   NULL,
    max_sfp_rx_power_dbm DECIMAL(8,4)   NULL,
    avg_sfp_temperature_c DECIMAL(8,4)  NULL,
    min_sfp_temperature_c DECIMAL(6,2)  NULL,
    max_sfp_temperature_c DECIMAL(6,2)  NULL,
    avg_ups_battery_pct DECIMAL(5,2)    NULL,
    min_ups_battery_pct SMALLINT        NULL,
    max_ups_battery_pct SMALLINT        NULL,
    avg_ups_runtime_min DECIMAL(10,2)   NULL,
    min_ups_runtime_min INT             NULL,
    max_ups_runtime_min INT             NULL,
    avg_poe_power_mw    DECIMAL(12,4)   NULL,
    min_poe_power_mw    INT             NULL,
    max_poe_power_mw    INT             NULL,
    avg_humidity_pct    DECIMAL(7,4)    NULL,
    min_humidity_pct    DECIMAL(5,2)    NULL,
    max_humidity_pct    DECIMAL(5,2)    NULL,
    avg_if_oper_status  DECIMAL(4,2)    NULL     COMMENT 'Average ifOperStatus (1=up ... 2=down)',
    min_if_oper_status  TINYINT         NULL,
    max_if_oper_status  TINYINT         NULL,
    sample_count        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT 'Number of daily samples aggregated',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_snmp_1month_device_iface_period (device_id, interface_id, period_start),
    KEY idx_snmp_1month_period_start (period_start),
    CONSTRAINT fk_snmp_1month_device FOREIGN KEY (device_id)
        REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Monthly SNMP metric aggregates — retained 3 years';

-- ---------------------------------------------------------------------------
-- Part 2: Seed snmp_rollup_state row for 1month
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO snmp_rollup_state (rollup_name, last_processed)
VALUES ('1month', NULL);

-- ---------------------------------------------------------------------------
-- Part 3: Recreate snmp_apply_retention() with correct thresholds
--         hourly → 7 days, daily → 90 days, monthly → 3 years
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS snmp_apply_retention;
DELIMITER $$
CREATE PROCEDURE snmp_apply_retention()
BEGIN
    DECLARE rows_deleted INT DEFAULT 1;

    -- §6.3 spec: hourly kept 7 days
    SET rows_deleted = 1;
    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics_1hr
        WHERE period_start < DATE_SUB(NOW(), INTERVAL 7 DAY)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;

    -- §6.3 spec: daily kept 90 days
    SET rows_deleted = 1;
    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics_1day
        WHERE period_start < DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;

    -- §6.3 spec: monthly kept 3 years
    SET rows_deleted = 1;
    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics_1month
        WHERE period_start < DATE_SUB(CURDATE(), INTERVAL 3 YEAR)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;
END$$
DELIMITER ;

-- Immediate no-op call to verify the procedure compiles correctly
CALL snmp_apply_retention();

-- ---------------------------------------------------------------------------
-- Part 4: Create snmp_rollup_to_1month()
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS snmp_rollup_to_1month;
DELIMITER $$
CREATE PROCEDURE snmp_rollup_to_1month()
proc: BEGIN
    DECLARE v_from_date DATE;
    DECLARE v_to_date   DATE;

    -- High-watermark: default to 3 years ago on first run
    SELECT COALESCE(DATE(last_processed), DATE_SUB(CURDATE(), INTERVAL 3 YEAR))
    INTO v_from_date
    FROM snmp_rollup_state
    WHERE rollup_name = '1month';

    -- Process up to (but not including) the current month to avoid partial months
    SET v_to_date = DATE_FORMAT(CURDATE(), '%Y-%m-01');

    IF v_from_date >= v_to_date THEN
        LEAVE proc;
    END IF;

    INSERT INTO snmp_metrics_1month
        (device_id, interface_id, period_start,
         avg_if_in_octets,    min_if_in_octets,    max_if_in_octets,
         avg_if_out_octets,   min_if_out_octets,   max_if_out_octets,
         avg_if_in_errors,    min_if_in_errors,    max_if_in_errors,
         avg_if_out_errors,   min_if_out_errors,   max_if_out_errors,
         avg_cpu_usage,       min_cpu_usage,        max_cpu_usage,
         avg_memory_usage,    min_memory_usage,     max_memory_usage,
         avg_signal_strength, min_signal_strength,  max_signal_strength,
         avg_latency_ms,      min_latency_ms,       max_latency_ms,
         avg_voltage_mv,      min_voltage_mv,       max_voltage_mv,
         avg_temperature_c,   min_temperature_c,    max_temperature_c,
         avg_fan_speed_rpm,   min_fan_speed_rpm,    max_fan_speed_rpm,
         avg_if_in_discards,  min_if_in_discards,   max_if_in_discards,
         avg_if_out_discards, min_if_out_discards,  max_if_out_discards,
         avg_sfp_tx_power_dbm, min_sfp_tx_power_dbm, max_sfp_tx_power_dbm,
         avg_sfp_rx_power_dbm, min_sfp_rx_power_dbm, max_sfp_rx_power_dbm,
         avg_sfp_temperature_c, min_sfp_temperature_c, max_sfp_temperature_c,
         avg_ups_battery_pct, min_ups_battery_pct,  max_ups_battery_pct,
         avg_ups_runtime_min, min_ups_runtime_min,  max_ups_runtime_min,
         avg_poe_power_mw,    min_poe_power_mw,     max_poe_power_mw,
         avg_humidity_pct,    min_humidity_pct,     max_humidity_pct,
         avg_if_oper_status,  min_if_oper_status,   max_if_oper_status,
         sample_count)
    SELECT
        device_id,
        interface_id,
        DATE_FORMAT(period_start, '%Y-%m-01')       AS period_start,
        AVG(avg_if_in_octets),    MIN(min_if_in_octets),    MAX(max_if_in_octets),
        AVG(avg_if_out_octets),   MIN(min_if_out_octets),   MAX(max_if_out_octets),
        AVG(avg_if_in_errors),    MIN(min_if_in_errors),    MAX(max_if_in_errors),
        AVG(avg_if_out_errors),   MIN(min_if_out_errors),   MAX(max_if_out_errors),
        AVG(avg_cpu_usage),       MIN(min_cpu_usage),        MAX(max_cpu_usage),
        AVG(avg_memory_usage),    MIN(min_memory_usage),     MAX(max_memory_usage),
        AVG(avg_signal_strength), MIN(min_signal_strength),  MAX(max_signal_strength),
        AVG(avg_latency_ms),      MIN(min_latency_ms),       MAX(max_latency_ms),
        AVG(avg_voltage_mv),      MIN(min_voltage_mv),       MAX(max_voltage_mv),
        AVG(avg_temperature_c),   MIN(min_temperature_c),    MAX(max_temperature_c),
        AVG(avg_fan_speed_rpm),   MIN(min_fan_speed_rpm),    MAX(max_fan_speed_rpm),
        AVG(avg_if_in_discards),  MIN(min_if_in_discards),   MAX(max_if_in_discards),
        AVG(avg_if_out_discards), MIN(min_if_out_discards),  MAX(max_if_out_discards),
        AVG(avg_sfp_tx_power_dbm), MIN(min_sfp_tx_power_dbm), MAX(max_sfp_tx_power_dbm),
        AVG(avg_sfp_rx_power_dbm), MIN(min_sfp_rx_power_dbm), MAX(max_sfp_rx_power_dbm),
        AVG(avg_sfp_temperature_c), MIN(min_sfp_temperature_c), MAX(max_sfp_temperature_c),
        AVG(avg_ups_battery_pct), MIN(min_ups_battery_pct),  MAX(max_ups_battery_pct),
        AVG(avg_ups_runtime_min), MIN(min_ups_runtime_min),  MAX(max_ups_runtime_min),
        AVG(avg_poe_power_mw),    MIN(min_poe_power_mw),     MAX(max_poe_power_mw),
        AVG(avg_humidity_pct),    MIN(min_humidity_pct),     MAX(max_humidity_pct),
        AVG(avg_if_oper_status),  MIN(min_if_oper_status),   MAX(max_if_oper_status),
        SUM(sample_count)
    FROM snmp_metrics_1day
    WHERE period_start >= v_from_date
      AND period_start <  v_to_date
    GROUP BY device_id, interface_id, DATE_FORMAT(period_start, '%Y-%m-01')
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets    = VALUES(avg_if_in_octets),
        min_if_in_octets    = VALUES(min_if_in_octets),
        max_if_in_octets    = VALUES(max_if_in_octets),
        avg_if_out_octets   = VALUES(avg_if_out_octets),
        min_if_out_octets   = VALUES(min_if_out_octets),
        max_if_out_octets   = VALUES(max_if_out_octets),
        avg_if_in_errors    = VALUES(avg_if_in_errors),
        min_if_in_errors    = VALUES(min_if_in_errors),
        max_if_in_errors    = VALUES(max_if_in_errors),
        avg_if_out_errors   = VALUES(avg_if_out_errors),
        min_if_out_errors   = VALUES(min_if_out_errors),
        max_if_out_errors   = VALUES(max_if_out_errors),
        avg_cpu_usage       = VALUES(avg_cpu_usage),
        min_cpu_usage       = VALUES(min_cpu_usage),
        max_cpu_usage       = VALUES(max_cpu_usage),
        avg_memory_usage    = VALUES(avg_memory_usage),
        min_memory_usage    = VALUES(min_memory_usage),
        max_memory_usage    = VALUES(max_memory_usage),
        avg_signal_strength = VALUES(avg_signal_strength),
        min_signal_strength = VALUES(min_signal_strength),
        max_signal_strength = VALUES(max_signal_strength),
        avg_latency_ms      = VALUES(avg_latency_ms),
        min_latency_ms      = VALUES(min_latency_ms),
        max_latency_ms      = VALUES(max_latency_ms),
        avg_voltage_mv      = VALUES(avg_voltage_mv),
        min_voltage_mv      = VALUES(min_voltage_mv),
        max_voltage_mv      = VALUES(max_voltage_mv),
        avg_temperature_c   = VALUES(avg_temperature_c),
        min_temperature_c   = VALUES(min_temperature_c),
        max_temperature_c   = VALUES(max_temperature_c),
        avg_fan_speed_rpm   = VALUES(avg_fan_speed_rpm),
        min_fan_speed_rpm   = VALUES(min_fan_speed_rpm),
        max_fan_speed_rpm   = VALUES(max_fan_speed_rpm),
        avg_if_in_discards  = VALUES(avg_if_in_discards),
        min_if_in_discards  = VALUES(min_if_in_discards),
        max_if_in_discards  = VALUES(max_if_in_discards),
        avg_if_out_discards = VALUES(avg_if_out_discards),
        min_if_out_discards = VALUES(min_if_out_discards),
        max_if_out_discards = VALUES(max_if_out_discards),
        avg_sfp_tx_power_dbm = VALUES(avg_sfp_tx_power_dbm),
        min_sfp_tx_power_dbm = VALUES(min_sfp_tx_power_dbm),
        max_sfp_tx_power_dbm = VALUES(max_sfp_tx_power_dbm),
        avg_sfp_rx_power_dbm = VALUES(avg_sfp_rx_power_dbm),
        min_sfp_rx_power_dbm = VALUES(min_sfp_rx_power_dbm),
        max_sfp_rx_power_dbm = VALUES(max_sfp_rx_power_dbm),
        avg_sfp_temperature_c = VALUES(avg_sfp_temperature_c),
        min_sfp_temperature_c = VALUES(min_sfp_temperature_c),
        max_sfp_temperature_c = VALUES(max_sfp_temperature_c),
        avg_ups_battery_pct = VALUES(avg_ups_battery_pct),
        min_ups_battery_pct = VALUES(min_ups_battery_pct),
        max_ups_battery_pct = VALUES(max_ups_battery_pct),
        avg_ups_runtime_min = VALUES(avg_ups_runtime_min),
        min_ups_runtime_min = VALUES(min_ups_runtime_min),
        max_ups_runtime_min = VALUES(max_ups_runtime_min),
        avg_poe_power_mw    = VALUES(avg_poe_power_mw),
        min_poe_power_mw    = VALUES(min_poe_power_mw),
        max_poe_power_mw    = VALUES(max_poe_power_mw),
        avg_humidity_pct    = VALUES(avg_humidity_pct),
        min_humidity_pct    = VALUES(min_humidity_pct),
        max_humidity_pct    = VALUES(max_humidity_pct),
        avg_if_oper_status  = VALUES(avg_if_oper_status),
        min_if_oper_status  = VALUES(min_if_oper_status),
        max_if_oper_status  = VALUES(max_if_oper_status),
        sample_count        = VALUES(sample_count);

    -- Advance the high-watermark
    UPDATE snmp_rollup_state
    SET last_processed = TIMESTAMP(v_to_date)
    WHERE rollup_name  = '1month';
END$$
DELIMITER ;

-- Immediate no-op call (no daily data before current month yet)
CALL snmp_rollup_to_1month();

-- ---------------------------------------------------------------------------
-- Part 5: Create/replace scheduled events
-- ---------------------------------------------------------------------------

-- Monthly rollup: run once per day at 01:00 (after 1day rollup at 00:30).
-- The proc only processes past complete months, so running daily is safe
-- and ensures monthly rows appear promptly after month-end.
DROP EVENT IF EXISTS evt_snmp_rollup_1month;
CREATE EVENT IF NOT EXISTS evt_snmp_rollup_1month
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 1 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Aggregate daily SNMP rows into snmp_metrics_1month once per day'
    DO CALL snmp_rollup_to_1month();

-- Recreate the retention event pointing to the updated snmp_apply_retention().
-- The procedure body is replaced above; the event continues calling it by name.
DROP EVENT IF EXISTS evt_snmp_retention;
CREATE EVENT IF NOT EXISTS evt_snmp_retention
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Purge SNMP data: 1hr>7d, 1day>90d, 1month>3yr'
    DO CALL snmp_apply_retention();
