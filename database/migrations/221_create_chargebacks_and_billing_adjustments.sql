-- =============================================================================
-- Migration 221: Chargebacks and billing adjustments tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: chargebacks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chargebacks (
    id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id         BIGINT UNSIGNED  NULL,
    payment_id              BIGINT UNSIGNED  NULL,
    gateway                 VARCHAR(50)      NULL    COMMENT 'stripe/conekta/etc',
    gateway_dispute_id      VARCHAR(200)     NULL,
    amount                  DECIMAL(12,2)    NOT NULL,
    currency                VARCHAR(3)       NOT NULL DEFAULT 'USD',
    reason_code             VARCHAR(100)     NULL,
    status                  ENUM('received','evidence_submitted','won','lost','accepted') NOT NULL DEFAULT 'received',
    due_by                  DATE             NULL    COMMENT 'Deadline for evidence submission',
    outcome_notes           TEXT             NULL,
    linked_refund_request_id BIGINT UNSIGNED NULL,
    created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at              DATETIME         NULL,

    PRIMARY KEY (id),
    KEY idx_chargebacks_organization_id (organization_id),
    KEY idx_chargebacks_payment_id (payment_id),
    UNIQUE KEY uq_chargebacks_gateway_dispute_id (gateway_dispute_id),
    KEY idx_chargebacks_status (status),
    KEY idx_chargebacks_deleted_at (deleted_at),
    CONSTRAINT fk_chargebacks_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: billing_adjustments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_adjustments (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL,
    client_id       BIGINT UNSIGNED  NOT NULL,
    entity_type     ENUM('invoice','payment','credit_note','balance') NOT NULL,
    entity_id       BIGINT UNSIGNED  NOT NULL,
    adjustment_type ENUM('late_fee_waiver','discount','correction','write_off','other') NOT NULL,
    amount_delta    DECIMAL(12,2)    NOT NULL COMMENT 'Positive = credit to client, negative = debit',
    reason          TEXT             NOT NULL,
    approved_by     BIGINT UNSIGNED  NULL,
    created_by      BIGINT UNSIGNED  NULL,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_billing_adjustments_organization_id (organization_id),
    KEY idx_billing_adjustments_client_id (client_id),
    KEY idx_billing_adjustments_entity (entity_type, entity_id),
    CONSTRAINT fk_billing_adjustments_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
