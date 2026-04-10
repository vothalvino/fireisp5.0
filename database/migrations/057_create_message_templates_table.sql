-- Migration: 057_create_message_templates_table
-- Description: Reusable message templates for emails, SMS, and WhatsApp.
--              Stores subject, body, and available placeholder variables so
--              operators can customise outbound communications (invoice
--              reminders, welcome messages, outage alerts, etc.) without
--              touching code.

CREATE TABLE IF NOT EXISTS message_templates (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL     COMMENT 'Owning tenant; NULL = global / system default',
    name            VARCHAR(100)     NOT NULL COMMENT 'Unique machine-readable name, e.g. invoice_reminder',
    channel         ENUM('email', 'sms', 'whatsapp', 'other') NOT NULL DEFAULT 'email',
    subject         VARCHAR(255)     NULL     COMMENT 'Email subject template (NULL for SMS/WhatsApp)',
    body            TEXT             NOT NULL COMMENT 'Template body — supports placeholder variables e.g. {{client_name}}',
    description     VARCHAR(255)     NULL     COMMENT 'Human-readable purpose of this template',
    variables       JSON             NULL     COMMENT 'List of available placeholder names, e.g. ["client_name","invoice_number"]',
    is_active       TINYINT(1)       NOT NULL DEFAULT 1,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_message_templates_org_name_channel (organization_id, name, channel),
    KEY idx_message_templates_channel (channel),
    KEY idx_message_templates_is_active (is_active),
    CONSTRAINT fk_message_templates_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
