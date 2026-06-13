-- =============================================================================
-- Migration 346 — Reseller Resource Allocation Tables (§19.2)
-- =============================================================================
-- Creates resource allocation tables that link resellers to existing resources:
--   reseller_ip_pool_allocations  — §5 ip_pools → reseller mapping
--   reseller_bandwidth_quotas     — §10 QoS bandwidth quotas per reseller
--   reseller_olt_port_assignments — §7 OLT port assignments per reseller
--   reseller_billing_entities     — per-reseller billing entity / invoice grouping
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- Table: reseller_ip_pool_allocations
-- Links §5 ip_pools records to a reseller (allocation mapping)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reseller_ip_pool_allocations (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reseller_id     BIGINT UNSIGNED NOT NULL,
    ip_pool_id      BIGINT UNSIGNED NOT NULL,
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_reseller_ip_pool (reseller_id, ip_pool_id),
    KEY idx_ripa_reseller_id (reseller_id),
    KEY idx_ripa_ip_pool_id (ip_pool_id),
    CONSTRAINT fk_ripa_reseller FOREIGN KEY (reseller_id)
        REFERENCES resellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ripa_ip_pool FOREIGN KEY (ip_pool_id)
        REFERENCES ip_pools (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: reseller_bandwidth_quotas
-- Per-reseller bandwidth allocation quota (reuses §10 concepts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reseller_bandwidth_quotas (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reseller_id         BIGINT UNSIGNED NOT NULL,
    download_mbps       INT UNSIGNED    NULL COMMENT 'Maximum aggregate download Mbps for all reseller subscribers',
    upload_mbps         INT UNSIGNED    NULL COMMENT 'Maximum aggregate upload Mbps for all reseller subscribers',
    burst_download_mbps INT UNSIGNED    NULL COMMENT 'Burst ceiling download Mbps',
    burst_upload_mbps   INT UNSIGNED    NULL COMMENT 'Burst ceiling upload Mbps',
    is_enforced         TINYINT(1)      NOT NULL DEFAULT 1,
    notes               TEXT            NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_reseller_bandwidth_quota (reseller_id),
    KEY idx_rbq_reseller_id (reseller_id),
    CONSTRAINT fk_rbq_reseller FOREIGN KEY (reseller_id)
        REFERENCES resellers (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: reseller_olt_port_assignments
-- Links §7 OLT ports to resellers (port assignment mapping)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reseller_olt_port_assignments (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reseller_id     BIGINT UNSIGNED NOT NULL,
    olt_port_id     BIGINT UNSIGNED NOT NULL,
    notes           TEXT            NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_reseller_olt_port (reseller_id, olt_port_id),
    KEY idx_ropa_reseller_id (reseller_id),
    KEY idx_ropa_olt_port_id (olt_port_id),
    CONSTRAINT fk_ropa_reseller FOREIGN KEY (reseller_id)
        REFERENCES resellers (id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_ropa_olt_port FOREIGN KEY (olt_port_id)
        REFERENCES olt_ports (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Table: reseller_billing_entities
-- Separate billing entity per reseller (invoice grouping / branding)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reseller_billing_entities (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reseller_id     BIGINT UNSIGNED NOT NULL,
    legal_name      VARCHAR(255)    NOT NULL COMMENT 'Legal entity name on invoices',
    tax_id          VARCHAR(50)     NULL     COMMENT 'Tax ID / RFC for the reseller entity',
    address         TEXT            NULL,
    city            VARCHAR(100)    NULL,
    state           VARCHAR(100)    NULL,
    country         VARCHAR(100)    NULL DEFAULT 'MX',
    zip_code        VARCHAR(20)     NULL,
    phone           VARCHAR(30)     NULL,
    email           VARCHAR(255)    NULL,
    invoice_prefix  VARCHAR(20)     NULL     COMMENT 'Invoice number prefix e.g. RES-001',
    invoice_footer  TEXT            NULL,
    bank_name       VARCHAR(255)    NULL,
    bank_account    VARCHAR(100)    NULL,
    bank_clabe      VARCHAR(18)     NULL     COMMENT 'Mexican CLABE interbank code',
    currency        VARCHAR(3)      NOT NULL DEFAULT 'USD',
    is_active       TINYINT(1)      NOT NULL DEFAULT 1,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_reseller_billing_entity (reseller_id),
    KEY idx_rbe_reseller_id (reseller_id),
    CONSTRAINT fk_rbe_reseller FOREIGN KEY (reseller_id)
        REFERENCES resellers (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
