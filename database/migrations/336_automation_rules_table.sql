-- =============================================================================
-- Migration 336 — §18.1 Workflow Automation: automation_rules + executions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: automation_rules
-- Purpose: Event-triggered if-X-then-Y workflow rules.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_rules (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(255)    NOT NULL,
    description         TEXT            NULL,
    trigger_event       VARCHAR(100)    NOT NULL COMMENT 'e.g. invoice.created, device.offline, client.suspended',
    trigger_conditions  JSON            NULL     COMMENT 'Array of {field, operator, value} conditions (AND logic)',
    action_type         VARCHAR(100)    NOT NULL COMMENT 'e.g. send_notification, suspend_contract, create_ticket, run_script, set_alert',
    action_config       JSON            NULL     COMMENT 'Action-specific parameters',
    is_enabled          TINYINT(1)      NOT NULL DEFAULT 1,
    run_count           INT UNSIGNED    NOT NULL DEFAULT 0,
    last_triggered_at   DATETIME        NULL,
    priority            SMALLINT        NOT NULL DEFAULT 50 COMMENT 'Higher = evaluated first',
    created_by          BIGINT UNSIGNED NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME        NULL,

    PRIMARY KEY (id),
    KEY idx_automation_rules_org (organization_id),
    KEY idx_automation_rules_trigger (trigger_event),
    KEY idx_automation_rules_enabled (is_enabled),
    KEY idx_automation_rules_deleted_at (deleted_at),
    CONSTRAINT fk_automation_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_automation_rules_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Event-triggered if-X-then-Y workflow automation rules (§18.1)';

-- ---------------------------------------------------------------------------
-- Table: automation_rule_executions
-- Purpose: Audit log of each automation rule firing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automation_rule_executions (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NOT NULL,
    automation_rule_id  BIGINT UNSIGNED NOT NULL,
    trigger_event       VARCHAR(100)    NOT NULL,
    trigger_payload     JSON            NULL     COMMENT 'Snapshot of the event that triggered this rule',
    status              ENUM('success','failure','skipped') NOT NULL DEFAULT 'success',
    result_message      TEXT            NULL,
    duration_ms         INT UNSIGNED    NULL,
    executed_at         DATETIME        NOT NULL DEFAULT (NOW()),
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_auto_rule_exec_org (organization_id),
    KEY idx_auto_rule_exec_rule (automation_rule_id),
    KEY idx_auto_rule_exec_status (status),
    KEY idx_auto_rule_exec_executed_at (executed_at),
    CONSTRAINT fk_auto_rule_exec_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_auto_rule_exec_rule FOREIGN KEY (automation_rule_id)
        REFERENCES automation_rules (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Execution audit log for automation_rules (§18.1)';
