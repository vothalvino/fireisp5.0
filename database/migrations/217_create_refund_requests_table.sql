-- =============================================================================
-- Migration 217: Refund requests table
-- =============================================================================

CREATE TABLE IF NOT EXISTS refund_requests (
    id                          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id             BIGINT UNSIGNED  NULL,
    client_id                   BIGINT UNSIGNED  NOT NULL,
    payment_id                  BIGINT UNSIGNED  NULL,
    invoice_id                  BIGINT UNSIGNED  NULL,
    amount                      DECIMAL(12,2)    NOT NULL,
    reason                      ENUM('overcharge','duplicate','cancellation','service_issue','other') NOT NULL,
    status                      ENUM('requested','under_review','approved','rejected','processed') NOT NULL DEFAULT 'requested',
    requested_by                BIGINT UNSIGNED  NULL    COMMENT 'users.id',
    reviewed_by                 BIGINT UNSIGNED  NULL,
    review_notes                TEXT             NULL,
    processed_at                DATETIME         NULL,
    refund_method               ENUM('original_method','credit_balance','manual') NULL,
    resulting_credit_note_id    BIGINT UNSIGNED  NULL,
    gateway_refund_reference    VARCHAR(200)     NULL,
    created_at                  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at                  DATETIME         NULL,

    PRIMARY KEY (id),
    KEY idx_refund_requests_organization_id (organization_id),
    KEY idx_refund_requests_client_id (client_id),
    KEY idx_refund_requests_payment_id (payment_id),
    KEY idx_refund_requests_invoice_id (invoice_id),
    KEY idx_refund_requests_status (status),
    KEY idx_refund_requests_deleted_at (deleted_at),
    CONSTRAINT fk_refund_requests_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
