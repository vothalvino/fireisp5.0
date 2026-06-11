-- =============================================================================
-- Migration 213: Cash reconciliation sessions table
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: cash_reconciliation_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_reconciliation_sessions (
    id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED  NULL,
    agent_user_id       BIGINT UNSIGNED  NOT NULL COMMENT 'Field agent who opened this session',
    opened_at           DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at           DATETIME         NULL,
    expected_total      DECIMAL(12,2)    NULL     COMMENT 'System-computed total of cash payments recorded during session window',
    counted_total       DECIMAL(12,2)    NULL     COMMENT 'Physical cash count submitted by the agent at close',
    variance            DECIMAL(12,2)    NULL     COMMENT 'counted_total - expected_total; negative = short, positive = over',
    status              ENUM('open','closed','approved','disputed') NOT NULL DEFAULT 'open',
    notes               TEXT             NULL,
    approved_by         BIGINT UNSIGNED  NULL     COMMENT 'Supervisor who approved or disputed the session',
    approved_at         DATETIME         NULL,
    created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at          DATETIME         NULL,

    PRIMARY KEY (id),
    KEY idx_cash_recon_organization_id (organization_id),
    KEY idx_cash_recon_agent_user_id (agent_user_id),
    KEY idx_cash_recon_status (status),
    KEY idx_cash_recon_opened_at (opened_at),
    KEY idx_cash_recon_deleted_at (deleted_at),
    CONSTRAINT fk_cash_recon_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cash_recon_agent FOREIGN KEY (agent_user_id)
        REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_cash_recon_approved_by FOREIGN KEY (approved_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
