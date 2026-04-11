-- Migration: 115_create_sms_logs_table
-- Description: SMS and WhatsApp notification logging per organization.
--              Complements email_logs (migration 046) for non-email channels.
--              Captures direction (outbound/inbound), provider, delivery status,
--              cost, and timestamps for billing reconciliation and audit trails.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS sms_logs (
    id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization that sent/received this message',
    client_id            BIGINT UNSIGNED  NULL                        COMMENT 'Client associated with this message; NULL = non-client recipient',
    phone_number         VARCHAR(20)      NOT NULL                    COMMENT 'Destination or source phone number in E.164 format',
    channel              ENUM('sms','whatsapp')
                                          NOT NULL                    COMMENT 'Delivery channel',
    direction            ENUM('outbound','inbound')
                                          NOT NULL DEFAULT 'outbound' COMMENT 'Message direction relative to the platform',
    template_id          BIGINT UNSIGNED  NULL                        COMMENT 'Message template used; NULL = ad-hoc message',
    message_body         TEXT             NOT NULL                    COMMENT 'Full text content of the message',
    provider             VARCHAR(50)      NULL                        COMMENT 'SMS/WhatsApp provider name (e.g. twilio, infobip, messagebird)',
    provider_message_id  VARCHAR(100)     NULL                        COMMENT 'Provider-assigned message identifier for status lookups',
    status               ENUM('queued','sent','delivered','failed','undelivered')
                                          NOT NULL DEFAULT 'queued'   COMMENT 'Delivery status',
    error_code           VARCHAR(20)      NULL                        COMMENT 'Provider-specific error code on failure',
    error_message        TEXT             NULL                        COMMENT 'Human-readable error description from the provider',
    cost                 DECIMAL(8, 5)    NULL                        COMMENT 'Per-message cost charged by the provider',
    sent_at              TIMESTAMP        NULL                        COMMENT 'Timestamp when the message was submitted to the provider',
    delivered_at         TIMESTAMP        NULL                        COMMENT 'Timestamp of confirmed delivery to the handset',
    created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_sms_logs_organization_id (organization_id),
    KEY idx_sms_logs_client_id (client_id),
    KEY idx_sms_logs_status (status),
    KEY idx_sms_logs_provider_message_id (provider_message_id),
    KEY idx_sms_logs_phone_number (phone_number),
    CONSTRAINT fk_sms_logs_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_sms_logs_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sms_logs_template FOREIGN KEY (template_id)
        REFERENCES message_templates (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
