-- Migration: 029_create_snmp_rollup_events
-- Description: Creates the snmp_rollup_state high-watermark table, MySQL stored
--              procedures, and scheduled events to automate SNMP metrics rollup,
--              partition maintenance, and retention.
--
-- Requires:    SET GLOBAL event_scheduler = ON;  (in my.cnf or at runtime)
--
-- Rollup flow: snmp_metrics (raw 5-min) -> snmp_metrics_1hr -> snmp_metrics_1day
-- Retention:   raw kept 90 days (via DROP PARTITION in snmp_maintain_partitions),
--              hourly kept 1 year (batch DELETE), daily kept indefinitely (3+ yrs)
--
-- High-watermark: snmp_rollup_state tracks last_processed per rollup tier so
--              missed runs catch up from where they stopped rather than only
--              looking back a fixed 2-hour window.

-- ---------------------------------------------------------------------------
-- Table: snmp_rollup_state
-- Purpose: Tracks the high-watermark timestamp for each rollup tier so that
--          rollup procedures pick up exactly where they left off after a missed
--          run or server restart.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snmp_rollup_state (
    rollup_name    VARCHAR(32)  NOT NULL COMMENT 'Rollup tier identifier (1hr, 1day)',
    last_processed TIMESTAMP    NULL     COMMENT 'High-watermark: last successfully processed timestamp',
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (rollup_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed initial state rows (ignored if already present)
INSERT IGNORE INTO snmp_rollup_state (rollup_name, last_processed) VALUES
    ('1hr',  NULL),
    ('1day', NULL);

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_rollup_to_1hr
-- Purpose:   Aggregate raw 5-min samples into hourly rows using a
--            high-watermark (snmp_rollup_state.last_processed) so missed runs
--            catch up automatically.  Uses INSERT ... ON DUPLICATE KEY UPDATE
--            so re-runs are idempotent.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_rollup_to_1hr()
proc: BEGIN
    DECLARE v_from_ts TIMESTAMP;
    DECLARE v_to_ts   TIMESTAMP;

    -- Read high-watermark; default to 90 days ago on first run
    SELECT COALESCE(last_processed, DATE_SUB(NOW(), INTERVAL 90 DAY))
    INTO v_from_ts
    FROM snmp_rollup_state
    WHERE rollup_name = '1hr';

    -- Process only complete hours (exclude the current, still-filling hour)
    SET v_to_ts = DATE_FORMAT(NOW(), '%Y-%m-%d %H:00:00');

    IF v_from_ts >= v_to_ts THEN
        LEAVE proc;
    END IF;

    INSERT INTO snmp_metrics_1hr
        (device_id, interface_id, period_start,
         avg_if_in_octets,    min_if_in_octets,    max_if_in_octets,
         avg_if_out_octets,   min_if_out_octets,   max_if_out_octets,
         avg_if_in_errors,    min_if_in_errors,    max_if_in_errors,
         avg_if_out_errors,   min_if_out_errors,   max_if_out_errors,
         avg_cpu_usage,       min_cpu_usage,        max_cpu_usage,
         avg_memory_usage,    min_memory_usage,     max_memory_usage,
         avg_signal_strength, min_signal_strength,  max_signal_strength,
         avg_latency_ms,      min_latency_ms,       max_latency_ms,
         sample_count)
    SELECT
        device_id,
        COALESCE(interface_id, '')                        AS interface_id,
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')       AS period_start,
        AVG(if_in_octets),    MIN(if_in_octets),    MAX(if_in_octets),
        AVG(if_out_octets),   MIN(if_out_octets),   MAX(if_out_octets),
        AVG(if_in_errors),    MIN(if_in_errors),    MAX(if_in_errors),
        AVG(if_out_errors),   MIN(if_out_errors),   MAX(if_out_errors),
        AVG(cpu_usage),       MIN(cpu_usage),        MAX(cpu_usage),
        AVG(memory_usage),    MIN(memory_usage),     MAX(memory_usage),
        AVG(signal_strength), MIN(signal_strength),  MAX(signal_strength),
        AVG(latency_ms),      MIN(latency_ms),       MAX(latency_ms),
        COUNT(*)
    FROM snmp_metrics
    WHERE polled_at >  v_from_ts
      AND polled_at <  v_to_ts
    GROUP BY
        device_id,
        COALESCE(interface_id, ''),
        DATE_FORMAT(polled_at, '%Y-%m-%d %H:00:00')
    AS new_data
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets    = new_data.avg_if_in_octets,
        min_if_in_octets    = new_data.min_if_in_octets,
        max_if_in_octets    = new_data.max_if_in_octets,
        avg_if_out_octets   = new_data.avg_if_out_octets,
        min_if_out_octets   = new_data.min_if_out_octets,
        max_if_out_octets   = new_data.max_if_out_octets,
        avg_if_in_errors    = new_data.avg_if_in_errors,
        min_if_in_errors    = new_data.min_if_in_errors,
        max_if_in_errors    = new_data.max_if_in_errors,
        avg_if_out_errors   = new_data.avg_if_out_errors,
        min_if_out_errors   = new_data.min_if_out_errors,
        max_if_out_errors   = new_data.max_if_out_errors,
        avg_cpu_usage       = new_data.avg_cpu_usage,
        min_cpu_usage       = new_data.min_cpu_usage,
        max_cpu_usage       = new_data.max_cpu_usage,
        avg_memory_usage    = new_data.avg_memory_usage,
        min_memory_usage    = new_data.min_memory_usage,
        max_memory_usage    = new_data.max_memory_usage,
        avg_signal_strength = new_data.avg_signal_strength,
        min_signal_strength = new_data.min_signal_strength,
        max_signal_strength = new_data.max_signal_strength,
        avg_latency_ms      = new_data.avg_latency_ms,
        min_latency_ms      = new_data.min_latency_ms,
        max_latency_ms      = new_data.max_latency_ms,
        sample_count        = new_data.sample_count;

    -- Advance the high-watermark
    UPDATE snmp_rollup_state
    SET last_processed = v_to_ts
    WHERE rollup_name  = '1hr';
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_rollup_to_1day
-- Purpose:   Aggregate hourly rows into daily rows using a high-watermark.
--            Idempotent via ON DUPLICATE KEY UPDATE.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_rollup_to_1day()
proc: BEGIN
    DECLARE v_from_date DATE;
    DECLARE v_to_date   DATE;

    -- Read high-watermark; default to 1 year ago on first run
    SELECT COALESCE(DATE(last_processed), DATE_SUB(CURDATE(), INTERVAL 1 YEAR))
    INTO v_from_date
    FROM snmp_rollup_state
    WHERE rollup_name = '1day';

    -- Process up to (but not including) today to avoid partial days
    SET v_to_date = CURDATE();

    IF v_from_date >= v_to_date THEN
        LEAVE proc;
    END IF;

    INSERT INTO snmp_metrics_1day
        (device_id, interface_id, period_start,
         avg_if_in_octets,    min_if_in_octets,    max_if_in_octets,
         avg_if_out_octets,   min_if_out_octets,   max_if_out_octets,
         avg_if_in_errors,    min_if_in_errors,    max_if_in_errors,
         avg_if_out_errors,   min_if_out_errors,   max_if_out_errors,
         avg_cpu_usage,       min_cpu_usage,        max_cpu_usage,
         avg_memory_usage,    min_memory_usage,     max_memory_usage,
         avg_signal_strength, min_signal_strength,  max_signal_strength,
         avg_latency_ms,      min_latency_ms,       max_latency_ms,
         sample_count)
    SELECT
        device_id,
        interface_id,
        DATE(period_start)                                AS period_start,
        AVG(avg_if_in_octets),    MIN(min_if_in_octets),    MAX(max_if_in_octets),
        AVG(avg_if_out_octets),   MIN(min_if_out_octets),   MAX(max_if_out_octets),
        AVG(avg_if_in_errors),    MIN(min_if_in_errors),    MAX(max_if_in_errors),
        AVG(avg_if_out_errors),   MIN(min_if_out_errors),   MAX(max_if_out_errors),
        AVG(avg_cpu_usage),       MIN(min_cpu_usage),        MAX(max_cpu_usage),
        AVG(avg_memory_usage),    MIN(min_memory_usage),     MAX(max_memory_usage),
        AVG(avg_signal_strength), MIN(min_signal_strength),  MAX(max_signal_strength),
        AVG(avg_latency_ms),      MIN(min_latency_ms),       MAX(max_latency_ms),
        SUM(sample_count)
    FROM snmp_metrics_1hr
    WHERE period_start >= v_from_date
      AND period_start <  v_to_date
    GROUP BY device_id, interface_id, DATE(period_start)
    AS new_data
    ON DUPLICATE KEY UPDATE
        avg_if_in_octets    = new_data.avg_if_in_octets,
        min_if_in_octets    = new_data.min_if_in_octets,
        max_if_in_octets    = new_data.max_if_in_octets,
        avg_if_out_octets   = new_data.avg_if_out_octets,
        min_if_out_octets   = new_data.min_if_out_octets,
        max_if_out_octets   = new_data.max_if_out_octets,
        avg_if_in_errors    = new_data.avg_if_in_errors,
        min_if_in_errors    = new_data.min_if_in_errors,
        max_if_in_errors    = new_data.max_if_in_errors,
        avg_if_out_errors   = new_data.avg_if_out_errors,
        min_if_out_errors   = new_data.min_if_out_errors,
        max_if_out_errors   = new_data.max_if_out_errors,
        avg_cpu_usage       = new_data.avg_cpu_usage,
        min_cpu_usage       = new_data.min_cpu_usage,
        max_cpu_usage       = new_data.max_cpu_usage,
        avg_memory_usage    = new_data.avg_memory_usage,
        min_memory_usage    = new_data.min_memory_usage,
        max_memory_usage    = new_data.max_memory_usage,
        avg_signal_strength = new_data.avg_signal_strength,
        min_signal_strength = new_data.min_signal_strength,
        max_signal_strength = new_data.max_signal_strength,
        avg_latency_ms      = new_data.avg_latency_ms,
        min_latency_ms      = new_data.min_latency_ms,
        max_latency_ms      = new_data.max_latency_ms,
        sample_count        = new_data.sample_count;

    -- Advance the high-watermark
    UPDATE snmp_rollup_state
    SET last_processed = TIMESTAMP(v_to_date)
    WHERE rollup_name  = '1day';
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_apply_retention
-- Purpose:   Purge hourly rows older than 1 year via batch DELETE.
--            Daily rows are kept indefinitely (3+ years).
--            Raw snmp_metrics retention is handled by snmp_maintain_partitions()
--            which uses instant DROP PARTITION instead of slow batch DELETE.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_apply_retention()
BEGIN
    DECLARE rows_deleted INT DEFAULT 1;

    -- Purge hourly data older than 1 year (batch DELETE — table is small enough)
    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics_1hr
        WHERE period_start < DATE_SUB(NOW(), INTERVAL 1 YEAR)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;
END$$

-- ---------------------------------------------------------------------------
-- Procedure: snmp_maintain_partitions
-- Purpose:   (1) Ensure monthly partitions exist for the next 3 months by
--                reorganising p_future before it is needed.
--            (2) Drop partitions whose upper bound is older than 90 days
--                (instant operation — replaces batch-DELETE retention for
--                raw snmp_metrics).
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS snmp_maintain_partitions()
BEGIN
    DECLARE v_month     DATE;
    DECLARE v_pname     VARCHAR(32);
    DECLARE v_next_ts   BIGINT;
    DECLARE v_exists    INT  DEFAULT 0;
    DECLARE v_cutoff_ts BIGINT;
    DECLARE v_old_pname VARCHAR(32);
    DECLARE v_done      TINYINT DEFAULT 0;

    -- Cursor selects partitions whose upper bound (partition_description) falls
    -- entirely before the 90-day cutoff so they contain only expired data.
    DECLARE c_old CURSOR FOR
        SELECT partition_name
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'snmp_metrics'
          AND partition_name != 'p_future'
          AND partition_description != 'MAXVALUE'
          AND CAST(partition_description AS UNSIGNED) <= v_cutoff_ts;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    -- -----------------------------------------------------------------------
    -- 1. Ensure explicit partitions exist for the next 3 full months
    -- -----------------------------------------------------------------------
    SET v_month = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01');

    WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
        SET v_pname   = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
        SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));

        SELECT COUNT(*) INTO v_exists
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'snmp_metrics'
          AND partition_name = v_pname;

        IF v_exists = 0 THEN
            -- Reorganise p_future to insert the new named partition before it
            SET @sql = CONCAT(
                'ALTER TABLE snmp_metrics REORGANIZE PARTITION p_future INTO (',
                'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
                'PARTITION p_future VALUES LESS THAN MAXVALUE)'
            );
            PREPARE stmt FROM @sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END IF;

        SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
    END WHILE;

    -- -----------------------------------------------------------------------
    -- 2. Drop partitions older than 90 days (instant — no row-by-row DELETE)
    -- -----------------------------------------------------------------------
    -- cutoff: any partition whose VALUES LESS THAN <= UNIX_TIMESTAMP(now-90d)
    -- holds only data that is already expired.
    SET v_cutoff_ts = UNIX_TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 90 DAY));
    SET v_done = 0;

    OPEN c_old;
    drop_loop: LOOP
        FETCH c_old INTO v_old_pname;
        IF v_done THEN LEAVE drop_loop; END IF;
        SET @sql = CONCAT('ALTER TABLE snmp_metrics DROP PARTITION ', v_old_pname);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END LOOP;
    CLOSE c_old;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Scheduled events (require event_scheduler = ON)
-- ---------------------------------------------------------------------------

-- Run hourly rollup every hour at minute :05
CREATE EVENT IF NOT EXISTS evt_snmp_rollup_1hr
    ON SCHEDULE EVERY 1 HOUR
    STARTS DATE_FORMAT(NOW() + INTERVAL 1 HOUR, '%Y-%m-%d %H:05:00')
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

-- Run retention purge once per day at 02:00 (hourly data only)
CREATE EVENT IF NOT EXISTS evt_snmp_retention
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Purge hourly SNMP data older than 1 year'
    DO CALL snmp_apply_retention();

-- Run partition maintenance daily at 03:00
-- Adds future month partitions and drops partitions older than 90 days
CREATE EVENT IF NOT EXISTS evt_snmp_partition_maintenance
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Maintain snmp_metrics monthly partitions: add future, drop expired'
    DO CALL snmp_maintain_partitions();
