-- Migration: 008_create_radius_table
-- Description: Creates the radius table for subscriber authentication accounts

-- Temporarily disable FK checks: ipv4_pool_id and ipv6_pool_id reference
-- ip_pools which is created in a later migration (018). Safe — MySQL stores
-- the FK metadata now and enforces it once the referenced table exists.
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS radius (
    id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    client_id     BIGINT UNSIGNED NOT NULL,
    contract_id   BIGINT UNSIGNED NULL,
    nas_id        BIGINT UNSIGNED NULL     COMMENT 'NAS this subscriber authenticates through',
    username      VARCHAR(64)     NOT NULL,
    password_hash VARCHAR(255)    NOT NULL,
    ip_address              VARCHAR(45)     NULL COMMENT 'Static IPv4 address if assigned',
    ipv6_address            VARCHAR(45)     NULL COMMENT 'Static IPv6 address if assigned (dual-stack)',
    ipv6_delegated_prefix   VARCHAR(45)     NULL COMMENT 'Delegated IPv6 prefix e.g. 2001:db8:abcd:: (DHCPv6-PD)',
    ipv6_prefix_len         TINYINT UNSIGNED NULL COMMENT 'Delegated prefix length e.g. 48, 56, 64',
    ipv4_pool_id  BIGINT UNSIGNED NULL     COMMENT 'IPv4 pool for dynamic address assignment (PPPoE)',
    ipv6_pool_id  BIGINT UNSIGNED NULL     COMMENT 'IPv6 pool for dynamic prefix delegation (PPPoE dual-stack)',
    mac_address   VARCHAR(17)     NULL COMMENT 'MAC address in XX:XX:XX:XX:XX:XX format',
    profile       VARCHAR(100)    NULL COMMENT 'RADIUS profile / bandwidth profile name',
    status        ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_radius_username (username),
    KEY idx_radius_client_id (client_id),
    KEY idx_radius_contract_id (contract_id),
    KEY idx_radius_nas_id (nas_id),
    KEY idx_radius_ipv4_pool_id (ipv4_pool_id),
    KEY idx_radius_ipv6_pool_id (ipv6_pool_id),
    KEY idx_radius_status (status),
    CONSTRAINT fk_radius_client FOREIGN KEY (client_id)
        REFERENCES clients (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_radius_contract FOREIGN KEY (contract_id)
        REFERENCES contracts (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_nas FOREIGN KEY (nas_id)
        REFERENCES nas (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_ipv4_pool FOREIGN KEY (ipv4_pool_id)
        REFERENCES ip_pools (id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_radius_ipv6_pool FOREIGN KEY (ipv6_pool_id)
        REFERENCES ip_pools (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
