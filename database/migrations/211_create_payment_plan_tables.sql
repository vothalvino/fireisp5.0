-- =============================================================================
-- Migration 211: Payment plans and installments tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: payment_plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plans (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    client_id           BIGINT UNSIGNED  NOT NULL,
    total_amount        DECIMAL(12,2)    NOT NULL,
    installment_count   INT UNSIGNED     NOT NULL DEFAULT 1,
    frequency           ENUM('weekly','biweekly','monthly') NOT NULL DEFAULT 'monthly',
    status              ENUM('active','completed','defaulted','cancelled') NOT NULL DEFAULT 'active',
    notes               TEXT             NULL,
    created_by          BIGINT UNSIGNED  NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME         NULL,

    PRIMARY KEY (id),
    KEY idx_payment_plans_organization_id (organization_id),
    KEY idx_payment_plans_client_id (client_id),
    KEY idx_payment_plans_status (status),
    KEY idx_payment_plans_deleted_at (deleted_at),
    CONSTRAINT fk_payment_plans_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payment_plans_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payment_plans_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_plan_installments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_plan_installments (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    plan_id             BIGINT UNSIGNED  NOT NULL,
    invoice_id          BIGINT UNSIGNED  NULL     COMMENT 'Invoice this installment covers; NULL until invoice is generated',
    sequence            INT UNSIGNED     NOT NULL COMMENT 'Order of this installment within the plan (1-based)',
    amount              DECIMAL(12,2)    NOT NULL,
    due_date            DATE             NOT NULL,
    status              ENUM('pending','paid','overdue') NOT NULL DEFAULT 'pending',
    paid_payment_id     BIGINT UNSIGNED  NULL     COMMENT 'Payment record that settled this installment',
    paid_at             DATETIME         NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_plan_sequence (plan_id, sequence),
    KEY idx_payment_plan_installments_organization_id (organization_id),
    KEY idx_payment_plan_installments_plan_id (plan_id),
    KEY idx_payment_plan_installments_invoice_id (invoice_id),
    KEY idx_payment_plan_installments_status (status),
    KEY idx_payment_plan_installments_due_date (due_date),
    CONSTRAINT fk_ppi_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ppi_plan FOREIGN KEY (plan_id)
        REFERENCES payment_plans (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ppi_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_ppi_paid_payment FOREIGN KEY (paid_payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Scheduled task: check overdue installments daily at 08:00
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES (NULL, 'check_installments_due', 'Mark overdue payment plan installments and emit notification events', '0 8 * * *', TRUE, 'normal');
