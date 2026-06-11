-- =============================================================================
-- Rollback 265: Remove monthly rollup and revert retention to prior thresholds
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop the new monthly rollup event and restore the retention event
-- ---------------------------------------------------------------------------
DROP EVENT IF EXISTS evt_snmp_rollup_1month;
DROP EVENT IF EXISTS evt_snmp_retention;

-- Restore evt_snmp_retention pointing to the pre-migration threshold (1yr hourly)
CREATE EVENT IF NOT EXISTS evt_snmp_retention
    ON SCHEDULE EVERY 1 DAY
    STARTS (CURRENT_DATE + INTERVAL 1 DAY + INTERVAL 2 HOUR)
    ON COMPLETION PRESERVE
    COMMENT 'Purge hourly SNMP data older than 1 year (pre-mig265 retention)'
    DO CALL snmp_apply_retention();

-- ---------------------------------------------------------------------------
-- Restore snmp_apply_retention() to 1-year hourly, indefinite daily
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS snmp_apply_retention;
DELIMITER $$
CREATE PROCEDURE snmp_apply_retention()
BEGIN
    DECLARE rows_deleted INT DEFAULT 1;

    -- Pre-migration 265 threshold: hourly kept 1 year
    WHILE rows_deleted > 0 DO
        DELETE FROM snmp_metrics_1hr
        WHERE period_start < DATE_SUB(NOW(), INTERVAL 1 YEAR)
        LIMIT 10000;
        SET rows_deleted = ROW_COUNT();
    END WHILE;
    -- Note: snmp_metrics_1day was kept indefinitely before this migration.
    -- snmp_metrics_1month may contain data — retain it to avoid data loss.
END$$
DELIMITER ;

-- ---------------------------------------------------------------------------
-- Remove monthly rollup procedure and state row
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS snmp_rollup_to_1month;

DELETE FROM snmp_rollup_state WHERE rollup_name = '1month';

-- ---------------------------------------------------------------------------
-- Drop the monthly rollup table
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS snmp_metrics_1month;
