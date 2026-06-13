-- =============================================================================
-- Migration 318: §16.7 Consumer Protection — service_modification_notices table
-- =============================================================================
-- New tables:
--   service_modification_notices — mandatory service change notice tracking
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: service_modification_notices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_modification_notices (
    id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id      BIGINT UNSIGNED NULL,
    client_id            BIGINT UNSIGNED NULL COMMENT 'NULL = applies to all subscribers',
    notice_type          ENUM('price_change','plan_change','tos_change',
                              'service_termination','interruption',
                              'upgrade','downgrade') NOT NULL,
    description          TEXT            NOT NULL,
    effective_date       DATE            NOT NULL COMMENT 'Date the change takes effect',
    notice_required_days INT             NOT NULL DEFAULT 30 COMMENT 'Regulatory minimum notice period in days',
    noticed_at           TIMESTAMP       NULL COMMENT 'When the notice was sent',
    status               ENUM('pending','sent','acknowledged','disputed')
                                         NOT NULL DEFAULT 'pending',
    channel              ENUM('email','sms','postal','portal','all')
                                         NOT NULL DEFAULT 'email',
    contract_id          BIGINT UNSIGNED NULL,
    notes                TEXT            NULL,
    created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    CONSTRAINT fk_svc_mod_notices_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_svc_mod_notices_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_svc_mod_notices_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Mandatory service change notice tracking for PROFECO compliance (§16.7)';
