-- =============================================================================
-- Migration 219: Billing disputes and dispute evidence tables
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: billing_disputes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS billing_disputes (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    client_id           BIGINT UNSIGNED  NOT NULL,
    invoice_id          BIGINT UNSIGNED  NULL,
    payment_id          BIGINT UNSIGNED  NULL,
    type                ENUM('billing_error','service_quality','unauthorized_charge','other') NOT NULL,
    status              ENUM('open','investigating','resolved_favor_client','resolved_favor_company','escalated') NOT NULL DEFAULT 'open',
    description         TEXT             NOT NULL,
    resolution_notes    TEXT             NULL,
    opened_by           BIGINT UNSIGNED  NULL,
    resolved_by         BIGINT UNSIGNED  NULL,
    resolved_at         DATETIME         NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME         NULL,

    PRIMARY KEY (id),
    KEY idx_billing_disputes_organization_id (organization_id),
    KEY idx_billing_disputes_client_id (client_id),
    KEY idx_billing_disputes_status (status),
    KEY idx_billing_disputes_deleted_at (deleted_at),
    CONSTRAINT fk_billing_disputes_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: dispute_evidence
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dispute_evidence (
    id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED  NULL,
    dispute_id      BIGINT UNSIGNED  NOT NULL,
    filename        VARCHAR(255)     NOT NULL,
    stored_path     VARCHAR(500)     NOT NULL,
    mime_type       VARCHAR(100)     NULL,
    size_bytes      INT UNSIGNED     NULL,
    uploaded_by     BIGINT UNSIGNED  NULL,
    note            TEXT             NULL,
    created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    KEY idx_dispute_evidence_organization_id (organization_id),
    KEY idx_dispute_evidence_dispute_id (dispute_id),
    CONSTRAINT fk_dispute_evidence_dispute FOREIGN KEY (dispute_id)
        REFERENCES billing_disputes (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dispute_evidence_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
