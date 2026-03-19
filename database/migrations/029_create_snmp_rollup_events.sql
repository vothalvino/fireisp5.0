-- Migration: 029_create_snmp_rollup_events
-- Description: Creates MySQL stored procedures and scheduled events to
--              automate SNMP metrics rollup and retention, providing the
--              MySQL equivalent of TimescaleDB continuous aggregates and
--              retention policies.
--
-- Requires:    SET GLOBAL event_scheduler = ON;  (in my.cnf or at runtime)
--
-- Rollup flow: snmp_metrics (raw 5-min) → snmp_metrics_1hr → snmp_metrics_1day
-- Retention:   raw kept 90 days, hourly kept 1 year, daily kept indefinitely (3+ yrs)

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_rollup_to_1hr
-- Purpose:   Aggregate the last 2 hours of raw 5-min samples into hourly
--            rows.  Uses INSERT … ON DUPLICATE KEY UPDATE so re-runs are
--            idempotent.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_rollup_to_1hr()
BEGIN
    INSERT INTO snmp_metrics_1hr
        (device_id, metric_name, period_start,
         avg_value, min_value, max_value, sample_count)
    SELECT
        device_id,
        metric_name,
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00') AS period_start,
        AVG(value_numeric),
        MIN(value_numeric),
        MAX(value_numeric),
        COUNT(*)
    FROM snmp_metrics
    WHERE polled_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      AND value_numeric IS NOT NULL
    GROUP BY device_id, metric_name, DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')
    ON DUPLICATE KEY UPDATE
        avg_value    = VALUES(avg_value),
        min_value    = VALUES(min_value),
        max_value    = VALUES(max_value),
        sample_count = VALUES(sample_count);
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_rollup_to_1day
-- Purpose:   Aggregate the last 2 days of hourly rows into daily rows.
--            Idempotent via ON DUPLICATE KEY UPDATE.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_rollup_to_1day()
BEGIN
    INSERT INTO snmp_metrics_1day
        (device_id, metric_name, period_start,
         avg_value, min_value, max_value, sample_count)
    SELECT
        device_id,
        metric_name,
        DATE(period_start) AS period_start,
        AVG(avg_value),
        MIN(min_value),
        MAX(max_value),
        SUM(sample_count)
    FROM snmp_metrics_1hr
    WHERE period_start >= DATE_SUB(CURDATE(), INTERVAL 2 DAY)
    GROUP BY device_id, metric_name, DATE(period_start)
    ON DUPLICATE KEY UPDATE
        avg_value    = VALUES(avg_value),
        min_value    = VALUES(min_value),
        max_value    = VALUES(max_value),
        sample_count = VALUES(sample_count);
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_apply_retention
-- Purpose:   Purge raw samples older than 90 days and hourly rows older than
--            1 year.  Daily rows are kept indefinitely (3+ years).
--            Deletes in batches of 10 000 to avoid long-running locks.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_apply_retention()
BEGIN
    DECLARE rows_deleted INT DEFAULT 1;

    -- Purge raw data older than 90 days (batch delete)
    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics
        WHERE polled_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;

    -- Purge hourly data older than 1 year (batch delete)
    SET rows_deleted = 1;
    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics_1hr
        WHERE period_start < DATE_SUB(NOW(), INTERVAL 1 YEAR)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Scheduled events (require event_scheduler = ON)
-- ---------------------------------------------------------------------------

-- Run hourly rollup every hour at minute :05
CREATE EVENT IF NOT EXISTS evt_snmp_rollup_1hr
    ON SCHEDULE EVERY 1 HOUR
    STARTS CURRENT_TIMESTAMP + INTERVAL (60 - MINUTE(CURRENT_TIMESTAMP) + 5) MINUTE
    ON COMPLETION PRESERVE
    COMMENT 'Aggregate raw SNMP samples into snmp_metrics_1hr every hour'
    DO CALL snmp_rollup_to_1hr();

-- Run daily rollup once per day at 00:30
CREATE EVENT IF NOT EXISTS evt_snmp_rollup_1day
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 30 MINUTE)
    ON COMPLETION PRESERVE
    COMMENT 'Aggregate hourly SNMP rows into snmp_metrics_1day once per day'
    DO CALL snmp_rollup_to_1day();

-- Run retention purge once per day at 02:00
CREATE EVENT IF NOT EXISTS evt_snmp_retention
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Purge raw SNMP data >90 days and hourly data >1 year'
    DO CALL snmp_apply_retention();
