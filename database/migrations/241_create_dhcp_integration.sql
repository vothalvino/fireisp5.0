-- =============================================================================
-- Migration 241: DHCP Server Integration
-- =============================================================================
-- Implements isp-platform-features.md §5.1 "Dual Stack (IPv4 + IPv6)":
--   Creates dhcp_servers for tracking KEA and MikroTik DHCP server endpoints,
--   and dhcp_static_reservations for IP/MAC binding with Option 82 support.
--
-- Tables created:
--   dhcp_servers             — DHCP server registry (KEA / MikroTik)
--   dhcp_static_reservations — Static IP-MAC reservations with pool and client binding
-- =============================================================================

CREATE TABLE IF NOT EXISTS `dhcp_servers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `server_type` ENUM('kea','mikrotik') NOT NULL DEFAULT 'kea',
  `host` VARCHAR(255) NOT NULL,
  `port` INT UNSIGNED NOT NULL DEFAULT 8000,
  `api_url` VARCHAR(500) NULL,
  `api_token` TEXT NULL COMMENT 'Encrypted API token',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_dhcp_servers_org` (`organization_id`),
  INDEX `idx_dhcp_servers_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `dhcp_static_reservations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `dhcp_server_id` BIGINT UNSIGNED NULL,
  `pool_id` BIGINT UNSIGNED NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `mac_address` VARCHAR(17) NOT NULL,
  `hostname` VARCHAR(255) NULL,
  `client_id` BIGINT UNSIGNED NULL,
  `contract_id` BIGINT UNSIGNED NULL,
  `option82_circuit_id` VARCHAR(255) NULL COMMENT 'DHCP Option 82 circuit ID for subscriber binding',
  `option82_remote_id` VARCHAR(255) NULL COMMENT 'DHCP Option 82 remote ID for subscriber binding',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_dhcp_reservations_org` (`organization_id`),
  INDEX `idx_dhcp_reservations_mac` (`mac_address`),
  INDEX `idx_dhcp_reservations_ip` (`ip_address`),
  CONSTRAINT `fk_dhcp_reservations_server`
    FOREIGN KEY (`dhcp_server_id`) REFERENCES `dhcp_servers` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_dhcp_reservations_pool`
    FOREIGN KEY (`pool_id`) REFERENCES `ip_pools` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_dhcp_reservations_client`
    FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_dhcp_reservations_contract`
    FOREIGN KEY (`contract_id`) REFERENCES `contracts` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
