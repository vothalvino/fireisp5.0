-- =============================================================================
-- Migration 314: §16.2 User Data Management tables
-- =============================================================================
-- New tables:
--   subscriber_consents         — Aviso de Privacidad consent tracking
--   dsar_requests               — DSAR workflow (access/erasure/portability)
--   identity_verification_records — INE/IFE/CURP identity verification
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: subscriber_consents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriber_consents (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    client_id       BIGINT UNSIGNED NOT NULL,
    consent_version VARCHAR(20)     NOT NULL COMMENT 'Privacy notice version, e.g. ''2026-01''',
    purpose         ENUM('service_delivery','marketing','analytics',
                         'third_party_sharing','lawful_retention') NOT NULL,
    given_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    withdrawn_at    TIMESTAMP       NULL,
    ip_address      VARCHAR(45)     NULL,
    channel         ENUM('web','app','paper','phone','email') NOT NULL DEFAULT 'web',
    document_hash   VARCHAR(64)     NULL COMMENT 'SHA-256 of the privacy notice version',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_subscriber_consents_org     (organization_id),
    KEY idx_subscriber_consents_client  (client_id),
    KEY idx_subscriber_consents_purpose (purpose),
    KEY idx_subscriber_consents_given_at (given_at),
    CONSTRAINT fk_sub_consents_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_sub_consents_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Aviso de Privacidad consent tracking per subscriber (§16.2)';

-- ---------------------------------------------------------------------------
-- Table: dsar_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dsar_requests (
    id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id   BIGINT UNSIGNED NULL,
    client_id         BIGINT UNSIGNED NOT NULL,
    request_type      ENUM('access','erasure','portability','rectification','restriction') NOT NULL,
    status            ENUM('pending','in_review','fulfilled','rejected','legal_hold')
                                      NOT NULL DEFAULT 'pending',
    legal_hold        TINYINT(1)      NOT NULL DEFAULT 0,
    legal_hold_reason TEXT            NULL,
    requested_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_at            TIMESTAMP       NULL COMMENT '30-day statutory deadline',
    fulfilled_at      TIMESTAMP       NULL,
    fulfilled_by      BIGINT UNSIGNED NULL,
    export_path       VARCHAR(500)    NULL COMMENT 'Path/URL to exported data package',
    notes             TEXT            NULL,
    created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_dsar_requests_org    (organization_id),
    KEY idx_dsar_requests_client (client_id),
    KEY idx_dsar_requests_status (status),
    KEY idx_dsar_requests_due_at (due_at),
    CONSTRAINT fk_dsar_requests_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_dsar_requests_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_dsar_requests_fulfilled_by FOREIGN KEY (fulfilled_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='DSAR workflow: request intake through fulfillment (§16.2)';

-- ---------------------------------------------------------------------------
-- Table: identity_verification_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity_verification_records (
    id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id       BIGINT UNSIGNED NULL,
    client_id             BIGINT UNSIGNED NOT NULL,
    id_type               ENUM('INE','IFE','CURP','passport','RFC') NOT NULL,
    id_number             VARCHAR(50)     NOT NULL,
    curp_checksum_valid   TINYINT(1)      NULL COMMENT 'NULL = not applicable; 1 = valid; 0 = invalid',
    verified_at           TIMESTAMP       NULL,
    verified_by           BIGINT UNSIGNED NULL,
    verification_method   ENUM('manual','automated','third_party') NOT NULL DEFAULT 'manual',
    status                ENUM('pending','verified','rejected','expired') NOT NULL DEFAULT 'pending',
    notes                 TEXT            NULL,
    created_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_identity_verif_org    (organization_id),
    KEY idx_identity_verif_client (client_id),
    KEY idx_identity_verif_status (status),
    CONSTRAINT fk_identity_verif_organization FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_identity_verif_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_identity_verif_verified_by FOREIGN KEY (verified_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='INE/IFE/CURP identity verification records per subscriber (§16.2)';
