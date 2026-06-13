-- =============================================================================
-- Migration 315: §16.3 IP Log Retention — gov_data_requests table
-- =============================================================================
-- New tables:
--   gov_data_requests — audit log of all government data requests (lawful interception)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: gov_data_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gov_data_requests (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id BIGINT UNSIGNED NULL,
    authority_name  VARCHAR(255)    NOT NULL COMMENT 'Name of requesting authority (ATDT, CRT, Policia Federal, etc)',
    authority_ref   VARCHAR(100)    NULL     COMMENT 'Official reference number of the request',
    request_type    ENUM('ip_traceability','cdr_export','traffic_mirror',
                         'subscriber_data','other') NOT NULL,
    client_id       BIGINT UNSIGNED NULL     COMMENT 'Subscriber involved (if identified)',
    ip_address      VARCHAR(45)     NULL     COMMENT 'IP address subject of the request',
    date_from       DATE            NULL,
    date_to         DATE            NULL,
    status          ENUM('received','processing','fulfilled','rejected','pending_legal_review')
                                    NOT NULL DEFAULT 'received',
    fulfilled_at    TIMESTAMP       NULL,
    fulfilled_by    BIGINT UNSIGNED NULL,
    legal_basis     TEXT            NULL     COMMENT 'Legal authority cited in the request',
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    row_hash        VARCHAR(64)     NULL     COMMENT 'SHA-256 of key fields for tamper-proof integrity check',
    PRIMARY KEY (id),
    KEY idx_gov_data_requests_org        (organization_id),
    KEY idx_gov_data_requests_client     (client_id),
    KEY idx_gov_data_requests_status     (status),
    KEY idx_gov_data_requests_created_at (created_at),
    CONSTRAINT fk_gov_data_requests_org FOREIGN KEY (organization_id)
        REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_gov_data_requests_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_gov_data_requests_fulfilled_by FOREIGN KEY (fulfilled_by)
        REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Audit log of all government data requests — lawful interception (§16.3)';
