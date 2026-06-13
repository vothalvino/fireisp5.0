-- =============================================================================
-- Migration 339 — §18.1 Auto-remediation scripts (reboot ONU if offline >5 min)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: remediation_rules
-- Purpose: Condition + stubbed action remediation rules (e.g. reboot device if offline).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remediation_rules (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(255)    NOT NULL,
    description         TEXT            NULL,
    condition_metric    VARCHAR(100)    NOT NULL COMMENT 'e.g. is_offline, packet_loss, cpu_usage',
    condition_operator  ENUM('gt','lt','gte','lte','eq','neq','is_true') NOT NULL DEFAULT 'is_true',
    condition_threshold DECIMAL(10,4)   NULL     COMMENT 'Threshold value for numeric metrics; NULL for boolean',
    condition_duration_minutes INT UNSIGNED NULL  COMMENT 'Must persist for N minutes before triggering',
    action_type         VARCHAR(100)    NOT NULL COMMENT 'e.g. reboot_device, send_notification, create_ticket',
    action_config       JSON            NULL     COMMENT 'Action parameters (device_id, message, etc.)',
    cooldown_minutes    INT UNSIGNED    NOT NULL DEFAULT 30 COMMENT 'Minimum minutes between consecutive remediations',
    is_enabled          TINYINT(1)      NOT NULL DEFAULT 1,
    run_count           INT UNSIGNED    NOT NULL DEFAULT 0,
    last_triggered_at   DATETIME        NULL,
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_remediation_rules_org (organization_id),
    KEY idx_remediation_rules_enabled (is_enabled),
    KEY idx_remediation_rules_deleted_at (deleted_at),
    CONSTRAINT fk_remediation_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_remediation_rules_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Auto-remediation rules: condition + stubbed device action (§18.1)';

-- ---------------------------------------------------------------------------
-- Table: remediation_executions
-- Purpose: Audit log of each remediation rule firing (device action is STUBBED).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remediation_executions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    remediation_rule_id BIGINT UNSIGNED NOT NULL,
    device_id           BIGINT UNSIGNED NULL,
    action_type         VARCHAR(100)    NOT NULL,
    status              ENUM('queued','success','failure','stubbed') NOT NULL DEFAULT 'stubbed'
                            COMMENT 'stubbed = action enqueued but not dispatched to live device',
    result_message      TEXT            NULL,
    duration_ms         INT UNSIGNED    NULL,
    executed_at         DATETIME        NOT NULL DEFAULT (NOW()),
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_remediation_exec_org (organization_id),
    KEY idx_remediation_exec_rule (remediation_rule_id),
    KEY idx_remediation_exec_device (device_id),
    KEY idx_remediation_exec_status (status),
    KEY idx_remediation_exec_executed_at (executed_at),
    CONSTRAINT fk_remediation_exec_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_remediation_exec_rule FOREIGN KEY (remediation_rule_id)
        REFERENCES remediation_rules (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log for remediation_rules executions (device action STUBBED) (§18.1)';
