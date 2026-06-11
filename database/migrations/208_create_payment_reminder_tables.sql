-- Migration 208: payment_reminder_settings and payment_reminder_logs tables, plus send_payment_reminders task

-- ---------------------------------------------------------------------------
-- Table: payment_reminder_settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_reminder_settings (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    days_before_due     JSON             NULL     COMMENT 'e.g. [7,3,1]',
    send_on_due         TINYINT(1)       NOT NULL DEFAULT 1,
    days_after_due      JSON             NULL     COMMENT 'e.g. [1,3,7,14]',
    enabled             TINYINT(1)       NOT NULL DEFAULT 1,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_reminder_settings_org (organization_id),
    CONSTRAINT fk_payment_reminder_settings_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: payment_reminder_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_reminder_logs (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    invoice_id          BIGINT UNSIGNED  NOT NULL,
    organization_id     BIGINT UNSIGNED  NOT NULL,
    stage               VARCHAR(50)      NOT NULL COMMENT 'e.g. before_7, on_due, after_3',
    sent_at             DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    channel             ENUM('email','sms') NOT NULL DEFAULT 'email',
    PRIMARY KEY (id),
    UNIQUE KEY uq_reminder_log_dedup (invoice_id, stage, channel),
    KEY idx_reminder_log_invoice (invoice_id),
    KEY idx_reminder_log_org (organization_id),
    CONSTRAINT fk_payment_reminder_logs_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_payment_reminder_logs_org     FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Scheduled task
-- ---------------------------------------------------------------------------
INSERT IGNORE INTO scheduled_tasks (organization_id, task_name, description, cron_expression, is_enabled, priority)
VALUES (NULL, 'send_payment_reminders', 'Send payment due and overdue reminder notifications', '0 * * * *', TRUE, 'normal');
