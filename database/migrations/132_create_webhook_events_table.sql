-- Migration: 132_create_webhook_events_table
-- Description: Stores inbound payment gateway webhook events for deduplication,
--              auditing, and reconciliation. Each row represents a single event
--              received from Stripe, Conekta, or another provider. The unique
--              constraint on (provider, provider_event_id) prevents processing
--              the same event twice.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS webhook_events (
    id                  BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED   NULL                        COMMENT 'Resolved tenant org (NULL if not yet matched)',
    provider            VARCHAR(50)       NOT NULL                    COMMENT 'Gateway provider name: stripe, conekta, etc.',
    provider_event_id   VARCHAR(255)      NOT NULL                    COMMENT 'Unique event ID assigned by the provider',
    event_type          VARCHAR(100)      NOT NULL                    COMMENT 'Provider event type, e.g. payment_intent.succeeded',
    payload             JSON              NOT NULL                    COMMENT 'Full raw event payload from the provider',
    status              ENUM('received','processing','processed','failed','ignored')
                                          NOT NULL DEFAULT 'received' COMMENT 'Processing status',
    error_message       TEXT              NULL                        COMMENT 'Error details if processing failed',
    transaction_id      BIGINT UNSIGNED   NULL                        COMMENT 'Linked payment_transactions record after reconciliation',
    processed_at        TIMESTAMP         NULL                        COMMENT 'When the event was fully processed',
    created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_webhook_events_provider_event (provider, provider_event_id),
    KEY idx_webhook_events_organization_id (organization_id),
    KEY idx_webhook_events_status (status),
    KEY idx_webhook_events_event_type (event_type),
    KEY idx_webhook_events_transaction_id (transaction_id),
    KEY idx_webhook_events_created_at (created_at),
    CONSTRAINT fk_webhook_events_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_webhook_events_transaction FOREIGN KEY (transaction_id)
        REFERENCES payment_transactions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
