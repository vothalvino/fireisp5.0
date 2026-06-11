-- =============================================================================
-- Migration 248: Automated partition capacity maintenance
-- =============================================================================
-- The partitioned tables snmp_metrics (migration 025) and connection_logs
-- (migration 032) were created with hardcoded monthly partitions ending at
-- 2026-07-01. The maintenance procedures from migrations 028/033 only ensured
-- partitions for CURDATE()+1 .. +3 months — never the CURRENT month — so any
-- database provisioned after the hardcoded ceiling would store current-month
-- rows in p_future until a later REORGANIZE (a full-copy operation), degrading
-- retention granularity.
--
-- This migration:
--   1. Recreates snmp_maintain_partitions() and
--      connection_logs_maintain_partitions() so the ensure-loop starts at the
--      current month instead of next month. Retention logic is unchanged. The
--      daily events created by migrations 028/033
--      (evt_snmp_partition_maintenance / evt_connection_logs_partition_maintenance)
--      call these procedures by name and pick up the fix automatically.
--   2. Materializes partitions for the current month through +3 months on both
--      tables immediately, via a temporary creation-only procedure (no
--      retention drops happen at migration time), lifting the 2026-07-01
--      ceiling even on databases where the event scheduler is disabled.
--
-- Re-runnable: procedure recreation is DROP+CREATE; partition creation checks
-- information_schema.PARTITIONS before each REORGANIZE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. snmp_maintain_partitions — ensure-loop now starts at the current month
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS snmp_maintain_partitions;

DELIMITER $$

CREATE PROCEDURE snmp_maintain_partitions()
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
    -- 1. Ensure explicit partitions exist for the current month through the
    --    next 3 full months (migration 248: was next-month start, which left
    --    the current month uncovered on databases provisioned after the
    --    hardcoded partition list of migration 025 ran out)
    -- -----------------------------------------------------------------------
    SET v_month = DATE_FORMAT(CURDATE(), '%Y-%m-01');

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
-- 1b. connection_logs_maintain_partitions — same current-month fix
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS connection_logs_maintain_partitions;

DELIMITER $$

CREATE PROCEDURE connection_logs_maintain_partitions()
BEGIN
    DECLARE v_month     DATE;
    DECLARE v_pname     VARCHAR(32);
    DECLARE v_next_ts   BIGINT;
    DECLARE v_exists    INT DEFAULT 0;

    -- -------------------------------------------------------------------
    -- 1. Ensure connection_logs has partitions for the current month
    --    through the next 3 full months (migration 248: was next-month
    --    start — see header)
    -- -------------------------------------------------------------------
    SET v_month = DATE_FORMAT(CURDATE(), '%Y-%m-01');

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
    -- 2. Drop connection_logs partitions older than 2 years
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
-- 2. Materialize partitions now (creation only — retention drops are left to
--    the daily maintenance events so a migration never deletes data)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_248_ensure_partitions;

DELIMITER $$

CREATE PROCEDURE migration_248_ensure_partitions()
BEGIN
    DECLARE v_month   DATE;
    DECLARE v_pname   VARCHAR(32);
    DECLARE v_next_ts BIGINT;
    DECLARE v_exists  INT DEFAULT 0;

    -- snmp_metrics: current month .. +3 months
    SET v_month = DATE_FORMAT(CURDATE(), '%Y-%m-01');
    WHILE v_month <= DATE_FORMAT(DATE_ADD(CURDATE(), INTERVAL 3 MONTH), '%Y-%m-01') DO
        SET v_pname   = CONCAT('p', DATE_FORMAT(v_month, '%Y_%m'));
        SET v_next_ts = UNIX_TIMESTAMP(DATE_ADD(v_month, INTERVAL 1 MONTH));

        SELECT COUNT(*) INTO v_exists
        FROM information_schema.PARTITIONS
        WHERE table_schema = DATABASE()
          AND table_name   = 'snmp_metrics'
          AND partition_name = v_pname;

        IF v_exists = 0 THEN
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

    -- connection_logs: current month .. +3 months
    SET v_month = DATE_FORMAT(CURDATE(), '%Y-%m-01');
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
END$$

DELIMITER ;

CALL migration_248_ensure_partitions();
DROP PROCEDURE IF EXISTS migration_248_ensure_partitions;
