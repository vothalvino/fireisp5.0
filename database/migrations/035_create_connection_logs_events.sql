-- Migration: 035_create_connection_logs_events
-- Description: Creates the MySQL stored procedure and scheduled event to automate
--              connection_logs partition maintenance and retention.
--
-- Requires:    SET GLOBAL event_scheduler = ON;  (in my.cnf or at runtime)
--
-- Retention:   connection_logs kept 2 years (via DROP PARTITION — compliance).

DELIMITER $$

-- ---------------------------------------------------------------------------
-- Procedure: connection_logs_maintain_partitions
-- Purpose:   (1) Ensure monthly partitions exist for the next 3 months on
--                connection_logs by reorganising p_future.
--            (2) Drop connection_logs partitions older than 2 years.
-- ---------------------------------------------------------------------------
CREATE PROCEDURE IF NOT EXISTS connection_logs_maintain_partitions()
BEGIN
    DECLARE v_month     DATE;
    DECLARE v_pname     VARCHAR(32);
    DECLARE v_next_ts   BIGINT;
    DECLARE v_exists    INT DEFAULT 0;

    -- -------------------------------------------------------------------
    -- 1. Ensure connection_logs has partitions for the next 3 full months
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
-- Scheduled events (require event_scheduler = ON)
-- ---------------------------------------------------------------------------

-- Run partition maintenance daily at 03:30
-- Adds future month partitions and drops expired partitions for
-- connection_logs (2-year retention)
CREATE EVENT IF NOT EXISTS evt_connection_logs_partition_maintenance
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 3 HOUR + INTERVAL 30 MINUTE)
    ON COMPLETION PRESERVE
    COMMENT 'Maintain connection_logs monthly partitions: add future, drop expired (2-year retention)'
    DO CALL connection_logs_maintain_partitions();
