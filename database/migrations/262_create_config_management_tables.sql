-- =============================================================================
-- Migration 262: Config Management Tables — §6.6
-- =============================================================================
-- Creates tables for device configuration template management, deployment
-- records, backup schedules, compliance rules, and compliance results.
-- Also extends device_config_backups with a diff_from_previous column.
--
-- Tables created:
--   config_templates            — Config template definitions with variables
--   config_deployment_records   — History of template deployments to devices
--   config_backup_schedules     — Per-device/org automated backup schedules
--   config_compliance_rules     — Rules for auditing config compliance
--   config_compliance_results   — Results of compliance audit runs
-- =============================================================================

-- ---------------------------------------------------------------------------
-- config_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_templates (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    device_type VARCHAR(50) NULL COMMENT 'Target device type filter (optional)',
    manufacturer VARCHAR(100) NULL COMMENT 'Target manufacturer filter (optional)',
    template_content LONGTEXT NOT NULL COMMENT 'Template text with {{variable}} placeholders',
    variables_schema JSON NULL COMMENT 'JSON schema describing expected variables',
    status ENUM('active','inactive','draft') NOT NULL DEFAULT 'active',
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_config_templates_org (organization_id),
    CONSTRAINT fk_config_templates_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- config_deployment_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_deployment_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    template_id BIGINT UNSIGNED NULL,
    device_id BIGINT UNSIGNED NOT NULL,
    deployed_by BIGINT UNSIGNED NULL,
    status ENUM('pending','running','success','failed','rolled_back') NOT NULL DEFAULT 'pending',
    variables_used JSON NULL COMMENT 'Actual variables substituted',
    result_output TEXT NULL COMMENT 'Device response or error message',
    deployed_at DATETIME NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_config_deployment_records_org (organization_id),
    KEY idx_config_deployment_records_device (device_id),
    CONSTRAINT fk_config_deployment_records_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_config_deployment_records_template FOREIGN KEY (template_id) REFERENCES config_templates (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_config_deployment_records_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_config_deployment_records_user FOREIGN KEY (deployed_by) REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- config_backup_schedules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_backup_schedules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    device_id BIGINT UNSIGNED NULL,
    schedule_name VARCHAR(255) NOT NULL,
    cron_expression VARCHAR(50) NOT NULL DEFAULT '0 2 * * *' COMMENT 'When to run backup',
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    last_run_at DATETIME NULL,
    last_status ENUM('success','failed','skipped') NULL,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_config_backup_schedules_org (organization_id),
    CONSTRAINT fk_config_backup_schedules_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_config_backup_schedules_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- config_compliance_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_compliance_rules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NULL,
    rule_type ENUM('must_contain','must_not_contain','regex_match','regex_not_match') NOT NULL DEFAULT 'must_contain',
    pattern TEXT NOT NULL COMMENT 'String or regex pattern to match against config content',
    severity ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
    applies_to_device_type VARCHAR(50) NULL COMMENT 'NULL = all types',
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    deleted_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_config_compliance_rules_org (organization_id),
    CONSTRAINT fk_config_compliance_rules_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- config_compliance_results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS config_compliance_results (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    rule_id BIGINT UNSIGNED NOT NULL,
    backup_id BIGINT UNSIGNED NOT NULL,
    device_id BIGINT UNSIGNED NOT NULL,
    result ENUM('pass','fail','error') NOT NULL DEFAULT 'fail',
    details TEXT NULL COMMENT 'Explanation of why rule passed or failed',
    evaluated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_compliance_results_device_time (device_id, evaluated_at),
    KEY idx_compliance_results_rule_result (rule_id, result),
    CONSTRAINT fk_compliance_results_rule FOREIGN KEY (rule_id) REFERENCES config_compliance_rules (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_compliance_results_backup FOREIGN KEY (backup_id) REFERENCES device_config_backups (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_compliance_results_device FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Extend device_config_backups with diff_from_previous column
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_262_alter_device_config_backups;
DELIMITER $$
CREATE PROCEDURE migration_262_alter_device_config_backups()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'device_config_backups'
          AND COLUMN_NAME = 'diff_from_previous'
    ) THEN
        ALTER TABLE device_config_backups
            ADD COLUMN diff_from_previous LONGTEXT NULL COMMENT 'Unified diff vs previous version (NULL for first backup)';
    END IF;
END$$
DELIMITER ;
CALL migration_262_alter_device_config_backups();
DROP PROCEDURE IF EXISTS migration_262_alter_device_config_backups;
