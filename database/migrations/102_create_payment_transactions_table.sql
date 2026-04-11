-- Migration: 102_create_payment_transactions_table
-- Description: Raw gateway transaction log for every payment attempt.
--              Records the provider's reference ID, status, raw request/response
--              payloads, and webhook data for auditing and reconciliation.

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS payment_transactions (
    id                        BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    payment_id                BIGINT UNSIGNED  NULL                        COMMENT 'Link to internal payment record; NULL while the gateway attempt is pending',
    payment_gateway_id        BIGINT UNSIGNED  NOT NULL                    COMMENT 'Gateway used for this transaction',
    client_id                 BIGINT UNSIGNED  NOT NULL                    COMMENT 'Client being charged',
    organization_id           BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization',
    gateway_reference_id      VARCHAR(255)     NOT NULL                    COMMENT 'Provider-assigned transaction / charge ID',
    amount                    DECIMAL(12, 2)   NOT NULL                    COMMENT 'Attempted charge amount',
    currency                  VARCHAR(3)       NOT NULL DEFAULT 'MXN'      COMMENT 'ISO 4217 currency code',
    gateway_status            ENUM('pending','succeeded','failed','refunded','disputed','cancelled')
                                               NOT NULL DEFAULT 'pending'  COMMENT 'Status as reported by the gateway',
    gateway_response_code     VARCHAR(50)      NULL                        COMMENT 'Provider-specific result/error code',
    gateway_response_message  TEXT             NULL                        COMMENT 'Human-readable message from the provider',
    raw_request               JSON             NULL                        COMMENT 'Outbound API request body (PII/card data must be scrubbed before storage)',
    raw_response              JSON             NULL                        COMMENT 'Full response body received from the provider',
    webhook_payload           JSON             NULL                        COMMENT 'Incoming webhook payload that triggered a status update',
    idempotency_key           VARCHAR(255)     NULL                        COMMENT 'Client-supplied idempotency key to prevent duplicate charges',
    created_at                TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_transactions_idempotency_key (idempotency_key),
    KEY idx_payment_transactions_payment_id (payment_id),
    KEY idx_payment_transactions_gateway_id (payment_gateway_id),
    KEY idx_payment_transactions_client_id (client_id),
    KEY idx_payment_transactions_organization_id (organization_id),
    KEY idx_payment_transactions_gateway_reference_id (gateway_reference_id),
    KEY idx_payment_transactions_gateway_status (gateway_status),
    CONSTRAINT fk_payment_transactions_payment FOREIGN KEY (payment_id)
        REFERENCES payments (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payment_transactions_gateway FOREIGN KEY (payment_gateway_id)
        REFERENCES payment_gateways (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_transactions_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_transactions_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
