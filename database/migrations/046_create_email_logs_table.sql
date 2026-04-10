-- Migration: 046_create_email_logs_table
-- Description: Email / SMS / WhatsApp send log for auditing. Records every
--              message sent to a client or internal user — invoices, reminders,
--              ticket replies, notifications — with delivery status tracking.

CREATE TABLE IF NOT EXISTS email_logs (
    id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    client_id        BIGINT UNSIGNED  NULL     COMMENT 'Client recipient; NULL for internal messages',
    user_id          BIGINT UNSIGNED  NULL     COMMENT 'Internal user recipient; NULL for client messages',
    channel          ENUM('email', 'sms', 'whatsapp', 'other') NOT NULL DEFAULT 'email',
    recipient        VARCHAR(255)     NOT NULL COMMENT 'Email address or phone number',
    subject          VARCHAR(255)     NULL,
    body             TEXT             NULL,
    template         VARCHAR(100)     NULL     COMMENT 'Template name used to render the message',
    reference_type   VARCHAR(50)      NULL     COMMENT 'Entity type the message relates to, e.g. invoice, ticket',
    reference_id     BIGINT UNSIGNED  NULL     COMMENT 'ID of the referenced entity',
    status           ENUM('queued', 'sent', 'delivered', 'failed', 'bounced') NOT NULL DEFAULT 'queued',
    error_message    TEXT             NULL     COMMENT 'Delivery error details when status = failed or bounced',
    sent_at          TIMESTAMP        NULL,
    created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_email_logs_client_id (client_id),
    KEY idx_email_logs_status (status),
    KEY idx_email_logs_reference (reference_type, reference_id),
    KEY idx_email_logs_sent_at (sent_at),
    CONSTRAINT fk_email_logs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_email_logs_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
