-- Migration: 108_create_webhooks_table
-- Description: Outbound webhook registrations per organization.
--              Each record defines a target URL, an HMAC signing secret,
--              the event names to subscribe to, and delivery parameters
--              (max retries, timeout). Delivery history is in webhook_deliveries.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS webhooks (
    id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED  NOT NULL                     COMMENT 'Tenant organization that owns this webhook',
    url               VARCHAR(2048)    NOT NULL                     COMMENT 'Target URL to POST events to',
    secret_encrypted  VARCHAR(500)     NULL                         COMMENT 'Encrypted HMAC signing secret for payload verification',
    events            JSON             NOT NULL                     COMMENT 'JSON array of event names to subscribe to, e.g. ["invoice.created","payment.received"]',
    is_active         TINYINT(1)       NOT NULL DEFAULT 1           COMMENT 'FALSE = webhook is paused and deliveries will not be attempted',
    description       TEXT             NULL                         COMMENT 'Optional human-readable description of this webhook',
    max_retries       TINYINT UNSIGNED NOT NULL DEFAULT 5           COMMENT 'Maximum number of delivery retry attempts on failure',
    timeout_seconds   TINYINT UNSIGNED NOT NULL DEFAULT 30          COMMENT 'HTTP request timeout in seconds per attempt',
    created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_webhooks_organization_id (organization_id),
    KEY idx_webhooks_is_active (is_active),
    CONSTRAINT fk_webhooks_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
