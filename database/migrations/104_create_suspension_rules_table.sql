-- Migration: 104_create_suspension_rules_table
-- Description: Configurable suspension rules per organization.
--              Each rule defines when and how overdue clients should be
--              notified, suspended, or disconnected based on days past due.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS suspension_rules (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL                         COMMENT 'Tenant organization that owns this rule',
    name                VARCHAR(150)     NOT NULL                         COMMENT 'Descriptive rule name, e.g. "Suspensión 30 días"',
    days_past_due       INT UNSIGNED     NOT NULL                         COMMENT 'Number of days overdue before this rule triggers',
    grace_period_days   INT UNSIGNED     NOT NULL DEFAULT 0               COMMENT 'Additional grace days after trigger before action is executed',
    action              ENUM('auto_suspend','notify_only','auto_disconnect')
                                         NOT NULL                         COMMENT 'Action to perform when rule fires',
    notify_before_days  INT UNSIGNED     NULL                             COMMENT 'Send a warning notification this many days before suspension; NULL = no advance notice',
    apply_to_plan_ids   JSON             NULL                             COMMENT 'JSON array of plan IDs this rule applies to; NULL = applies to all plans',
    is_active           TINYINT(1)       NOT NULL DEFAULT 1               COMMENT 'FALSE = rule is disabled and will not be evaluated',
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_suspension_rules_organization_id (organization_id),
    KEY idx_suspension_rules_is_active (is_active),
    CONSTRAINT fk_suspension_rules_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
