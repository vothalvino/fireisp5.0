-- Migration 206: late_fee_rules and invoice_late_fees tables, plus apply_late_fees task

-- ---------------------------------------------------------------------------
-- Table: late_fee_rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS late_fee_rules (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    name                VARCHAR(255)     NOT NULL,
    fee_type            ENUM('flat','percent') NOT NULL DEFAULT 'flat',
    fee_amount          DECIMAL(10,2)    NOT NULL DEFAULT 0.00,
    grace_period_days   INT              NOT NULL DEFAULT 0 COMMENT 'Additional days beyond suspension grace period',
    max_applications    INT              NULL     COMMENT 'NULL = unlimited; 1 = one-time',
    is_active           TINYINT(1)       NOT NULL DEFAULT 1,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_late_fee_rules_org (organization_id),
    CONSTRAINT fk_late_fee_rules_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: invoice_late_fees
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_late_fees (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    invoice_id          BIGINT UNSIGNED  NOT NULL,
    late_fee_rule_id    BIGINT UNSIGNED  NOT NULL,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    amount              DECIMAL(10,2)    NOT NULL,
    applied_at          DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_by          BIGINT UNSIGNED  NULL     COMMENT 'NULL = system automation',
    invoice_item_id     BIGINT UNSIGNED  NULL     COMMENT 'FK to the invoice_items row created for this late fee',
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_invoice_late_fees_invoice (invoice_id),
    KEY idx_invoice_late_fees_rule (late_fee_rule_id),
    KEY idx_invoice_late_fees_org (organization_id),
    CONSTRAINT fk_invoice_late_fees_invoice      FOREIGN KEY (invoice_id)       REFERENCES invoices (id)        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_invoice_late_fees_rule         FOREIGN KEY (late_fee_rule_id) REFERENCES late_fee_rules (id)  ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_invoice_late_fees_org          FOREIGN KEY (organization_id)  REFERENCES organizations (id)   ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Scheduled task
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES (NULL, 'apply_late_fees', 'Apply configured late fees to overdue invoices', '0 2 * * *', TRUE, 'normal');
