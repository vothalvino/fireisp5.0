-- Migration: 037_create_netflow_rollup_events
-- Description: Creates the netflow_rollup_state high-watermark table, MySQL stored
--              procedures, and scheduled events to automate NetFlow usage rollup,
--              partition maintenance, and retention for both netflow_usage and
--              connection_logs tables.
--
-- Requires:    SET GLOBAL event_scheduler = ON;  (in my.cnf or at runtime)
--
-- Rollup flow: netflow_usage (raw 5-min) -> netflow_usage_1day
-- Retention:   raw netflow_usage kept 90 days (via DROP PARTITION),
--              daily netflow_usage_1day kept indefinitely (3+ yrs),
--              connection_logs kept 2 years (via DROP PARTITION — compliance).
--
-- High-watermark: netflow_rollup_state tracks last_processed per rollup tier so
--              missed runs catch up from where they stopped rather than only
--              looking back a fixed window.

-- ---------------------------------------------------------------------------
-- Table: netflow_rollup_state
-- Purpose: Tracks the high-watermark timestamp for the netflow daily rollup
--          so the procedure picks up exactly where it left off after a missed
--          run or server restart.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS netflow_rollup_state (
    rollup_name    VARCHAR(32)  NOT NULL COMMENT 'Rollup tier identifier (1day)',
    last_processed TIMESTAMP    NULL     COMMENT 'High-watermark: last successfully processed timestamp',
    updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (rollup_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed initial state row (ignored if already present)
INSERT IGNORE INTO netflow_rollup_state (rollup_name, last_processed) VALUES
    ('1day', NULL);

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Procedure: netflow_rollup_to_1day
-- Purpose:   Aggregate raw 5-min netflow_usage samples into daily rows using a
--            high-watermark (netflow_rollup_state.last_processed) so missed runs
--            catch up automatically.  Uses INSERT ... ON DUPLICATE KEY UPDATE
--            so re-runs are idempotent.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS netflow_rollup_to_1day()
proc: BEGIN
    DECLARE v_from_ts TIMESTAMP;
    DECLARE v_to_ts   TIMESTAMP;

    -- Read high-watermark; default to 90 days ago on first run
    SELECT COALESCE(last_processed, DATE_SUB(NOW(), INTERVAL 90 DAY))
    INTO v_from_ts
    FROM netflow_rollup_state
    WHERE rollup_name = '1day';

    -- Process up to (but not including) the current day to avoid partial days
    SET v_to_ts = TIMESTAMP(CURDATE());

    IF v_from_ts >= v_to_ts THEN
        LEAVE proc;
    END IF;

    INSERT INTO netflow_usage_1day
        (contract_id, period_start,
         sum_bytes_in, sum_bytes_out,
         sum_packets_in, sum_packets_out,
         sample_count)
    SELECT
        contract_id,
        DATE(sampled_at)                                  AS period_start,
        SUM(bytes_in),    SUM(bytes_out),
        SUM(packets_in),  SUM(packets_out),
        COUNT(*)
    FROM netflow_usage
    WHERE sampled_at >  v_from_ts
      AND sampled_at <  v_to_ts
    GROUP BY contract_id, DATE(sampled_at)
    AS new_data
    ON DUPLICATE KEY UPDATE
        sum_bytes_in    = new_data.sum_bytes_in,
        sum_bytes_out   = new_data.sum_bytes_out,
        sum_packets_in  = new_data.sum_packets_in,
        sum_packets_out = new_data.sum_packets_out,
        sample_count    = new_data.sample_count;

    -- Advance the high-watermark
    UPDATE netflow_rollup_state
    SET last_processed = v_to_ts
    WHERE rollup_name  = '1day';
END$$

-- ---------------------------------------------------------------------------
-- Procedure: netflow_maintain_partitions
-- Purpose:   (1) Ensure monthly partitions exist for the next 3 months on both
--                netflow_usage and connection_logs by reorganising p_future.
--            (2) Drop netflow_usage partitions older than 90 days.
--            (3) Drop connection_logs partitions older than 2 years.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS netflow_maintain_partitions()
BEGIN
    DECLARE v_month     DATE;
    DECLARE v_pname     VARCHAR(32);
    DECLARE v_next_ts   BIGINT;
    DECLARE v_exists    INT  DEFAULT 0;
    DECLARE v_cutoff_ts BIGINT;
    DECLARE v_old_pname VARCHAR(32);
    DECLARE v_done      TINYINT DEFAULT 0;

    -- Cursor: expired netflow_usage partitions (> 90 days)
    DECLARE c_old_nf CURSOR FOR
        SELECT partition_name
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'netflow_usage'
          AND partition_name != 'p_future'
          AND partition_description != 'MAXVALUE'
          AND CAST(partition_description AS UNSIGNED) <= v_cutoff_ts;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    -- -------------------------------------------------------------------
    -- 1a. Ensure netflow_usage has partitions for the next 3 full months
    -- -------------------------------------------------------------------
    SET v_month = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01');

    WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
        SET v_pname   = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
        SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));

        SELECT COUNT(*) INTO v_exists
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'netflow_usage'
          AND partition_name = v_pname;

        IF v_exists = 0 THEN
            SET @sql = CONCAT(
                'ALTER TABLE netflow_usage REORGANIZE PARTITION p_future INTO (',
                'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
                'PARTITION p_future VALUES LESS THAN MAXVALUE)'
            );
            PREPARE stmt FROM @sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END IF;

        SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
    END WHILE;

    -- -------------------------------------------------------------------
    -- 1b. Ensure connection_logs has partitions for the next 3 full months
    -- -------------------------------------------------------------------
    SET v_month = DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01');

    WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
        SET v_pname   = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
        SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));

        SELECT COUNT(*) INTO v_exists
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'connection_logs'
          AND partition_name = v_pname;

        IF v_exists = 0 THEN
            SET @sql = CONCAT(
                'ALTER TABLE connection_logs REORGANIZE PARTITION p_future INTO (',
                'PARTITION ', v_pname, ' VALUES LESS THAN (', v_next_ts, '), ',
                'PARTITION p_future VALUES LESS THAN MAXVALUE)'
            );
            PREPARE stmt FROM @sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END IF;

        SET v_month = DATE_ADD(v_month, INTERVAL 1 MONTH);
    END WHILE;

    -- -------------------------------------------------------------------
    -- 2. Drop netflow_usage partitions older than 90 days
    -- -------------------------------------------------------------------
    SET v_cutoff_ts = UNIX_TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 90 DAY));
    SET v_done = 0;

    OPEN c_old_nf;
    drop_nf_loop: LOOP
        FETCH c_old_nf INTO v_old_pname;
        IF v_done THEN LEAVE drop_nf_loop; END IF;
        SET @sql = CONCAT('ALTER TABLE netflow_usage DROP PARTITION ', v_old_pname);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END LOOP;
    CLOSE c_old_nf;

    -- -------------------------------------------------------------------
    -- 3. Drop connection_logs partitions older than 2 years
    -- -------------------------------------------------------------------
    BEGIN
        DECLARE v_cutoff_cl BIGINT;
        DECLARE v_old_cl    VARCHAR(32);
        DECLARE v_done_cl   TINYINT DEFAULT 0;

        DECLARE c_old_cl CURSOR FOR
            SELECT partition_name
            FROM information_schema.PARTITIONS
            WHERE table_schema = DATABASE()
              AND table_name   = 'connection_logs'
              AND partition_name != 'p_future'
              AND partition_description != 'MAXVALUE'
              AND CAST(partition_description AS UNSIGNED) <= v_cutoff_cl;

        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_cl = 1;

        SET v_cutoff_cl = UNIX_TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 YEAR));

        OPEN c_old_cl;
        drop_cl_loop: LOOP
            FETCH c_old_cl INTO v_old_cl;
            IF v_done_cl THEN LEAVE drop_cl_loop; END IF;
            SET @sql = CONCAT('ALTER TABLE connection_logs DROP PARTITION ', v_old_cl);
            PREPARE stmt FROM @sql;
            EXECUTE stmt;
            DEALLOCATE PREPARE stmt;
        END LOOP;
        CLOSE c_old_cl;
    END;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Scheduled events (require event_scheduler = ON)
-- ---------------------------------------------------------------------------

-- Run daily rollup once per day at 01:00
CREATE EVENT IF NOT EXISTS evt_netflow_rollup_1day
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 1 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Aggregate raw netflow_usage samples into netflow_usage_1day once per day'
    DO CALL netflow_rollup_to_1day();

-- Run partition maintenance daily at 03:30
-- Adds future month partitions and drops expired partitions for both
-- netflow_usage (90 days) and connection_logs (2 years)
CREATE EVENT IF NOT EXISTS evt_netflow_partition_maintenance
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR + INTERVAL 30 MINUTE)
    ON COMPLETION PRESERVE
    COMMENT 'Maintain netflow_usage and connection_logs monthly partitions: add future, drop expired'
    DO CALL netflow_maintain_partitions();
