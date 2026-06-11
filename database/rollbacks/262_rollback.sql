-- Rollback 262: Drop config management tables + diff column

DROP PROCEDURE IF EXISTS _rollback_262_drop_diff_col;
DELIMITER $$
CREATE PROCEDURE _rollback_262_drop_diff_col()
BEGIN
    IF EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'device_config_backups'
          AND COLUMN_NAME = 'diff_from_previous'
    ) THEN
        ALTER TABLE device_config_backups DROP COLUMN diff_from_previous;
    END IF;
END$$
DELIMITER ;
CALL _rollback_262_drop_diff_col();
DROP PROCEDURE IF EXISTS _rollback_262_drop_diff_col;

DROP TABLE IF EXISTS config_compliance_results;
DROP TABLE IF EXISTS config_compliance_rules;
DROP TABLE IF EXISTS config_backup_schedules;
DROP TABLE IF EXISTS config_deployment_records;
DROP TABLE IF EXISTS config_templates;
