-- =============================================================================
-- Migration 153 — Create payment_retries table
-- =============================================================================
-- Tracks failed payment charges and schedules automatic retry attempts.
-- Each row represents a retry schedule for a failed payment_transaction.
-- Retries follow an exponential backoff: 4h → 24h → 72h (3 attempts max).
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS payment_retries (
    id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED  NOT NULL                    COMMENT 'Tenant organization',
    transaction_id        BIGINT UNSIGNED  NOT NULL                    COMMENT 'Original failed payment_transactions record',
    client_id             BIGINT UNSIGNED  NOT NULL                    COMMENT 'Client being charged',
    invoice_id            BIGINT UNSIGNED  NULL                        COMMENT 'Invoice the charge is for (if known)',
    recurring_profile_id  BIGINT UNSIGNED  NULL                        COMMENT 'Recurring payment profile used for retry (if applicable)',
    amount                DECIMAL(12, 2)   NOT NULL                    COMMENT 'Amount to retry charging',
    currency              VARCHAR(3)       NOT NULL DEFAULT 'MXN'      COMMENT 'ISO 4217 currency code',
    attempt_number        TINYINT UNSIGNED NOT NULL DEFAULT 0          COMMENT 'Number of retry attempts executed so far',
    max_attempts          TINYINT UNSIGNED NOT NULL DEFAULT 3          COMMENT 'Maximum retry attempts allowed',
    status                ENUM('pending','processing','succeeded','exhausted','cancelled')
                                           NOT NULL DEFAULT 'pending'  COMMENT 'Current retry schedule status',
    last_error            TEXT             NULL                        COMMENT 'Error message from the most recent retry attempt',
    last_attempt_at       TIMESTAMP        NULL                        COMMENT 'When the last retry attempt was executed',
    next_retry_at         TIMESTAMP        NULL                        COMMENT 'Scheduled time for the next retry attempt',
    completed_at          TIMESTAMP        NULL                        COMMENT 'When the retry schedule completed (succeeded or exhausted)',
    created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_payment_retries_organization_id (organization_id),
    KEY idx_payment_retries_transaction_id (transaction_id),
    KEY idx_payment_retries_client_id (client_id),
    KEY idx_payment_retries_invoice_id (invoice_id),
    KEY idx_payment_retries_status_next_retry (status, next_retry_at),
    CONSTRAINT fk_payment_retries_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_retries_transaction FOREIGN KEY (transaction_id)
        REFERENCES payment_transactions (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_retries_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_retries_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_payment_retries_profile FOREIGN KEY (recurring_profile_id)
        REFERENCES recurring_payment_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT chk_payment_retries_attempts CHECK (attempt_number <= max_attempts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
