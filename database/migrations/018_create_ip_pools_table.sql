-- ---------------------------------------------------------------------------
-- Migration 018: Create ip_pools table
-- Purpose: IP address pools available for subscriber assignment (IPAM)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_pools (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255)    NOT NULL COMMENT 'Pool name e.g. Residential-Pool-1',
    network     VARCHAR(45)     NOT NULL COMMENT 'Network address e.g. 10.0.0.0',
    cidr        TINYINT UNSIGNED NOT NULL COMMENT 'CIDR prefix length e.g. 24',
    gateway     VARCHAR(45)     NULL     COMMENT 'Default gateway for the pool',
    dns_primary VARCHAR(45)     NULL     COMMENT 'Primary DNS server',
    dns_secondary VARCHAR(45)   NULL     COMMENT 'Secondary DNS server',
    site_id     BIGINT UNSIGNED NULL     COMMENT 'Site / POP the pool is served from',
    notes       TEXT            NULL,
    status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ip_pools_network_cidr (network, cidr),
    KEY idx_ip_pools_site_id (site_id),
    KEY idx_ip_pools_status (status),
    CONSTRAINT fk_ip_pools_site FOREIGN KEY (site_id)
        REFERENCES sites (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
