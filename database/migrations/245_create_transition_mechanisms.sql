-- =============================================================================
-- Migration 245: IPv6 Transition Mechanism Tables
-- =============================================================================
-- Implements isp-platform-features.md §5 "Dual Stack (IPv4 + IPv6)":
--   Creates configuration tables for IPv6 transition technologies:
--   6rd (RFC 5969), DS-Lite (RFC 6333), MAP-E/MAP-T (RFC 7597/7599),
--   and 464XLAT (RFC 6877).
--
-- Tables created:
--   tunnel_6rd_configs  — 6rd tunnel Border Relay and CE configuration
--   ds_lite_configs     — DS-Lite AFTR / B4 configuration
--   map_rules           — MAP-E / MAP-T rule definitions
--   xlat464_configs     — 464XLAT PLAT/CLAT configuration
-- =============================================================================

CREATE TABLE IF NOT EXISTS `tunnel_6rd_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `border_relay_ip` VARCHAR(45) NOT NULL COMMENT 'IPv4 address of the 6rd Border Relay',
  `ipv6_prefix` VARCHAR(50) NOT NULL COMMENT 'Delegated 6rd IPv6 prefix',
  `ipv4_mask_len` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Number of IPv4 prefix bits shared by all CEs',
  `mtu` INT UNSIGNED NOT NULL DEFAULT 1480,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_6rd_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ds_lite_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `aftr_address` VARCHAR(45) NOT NULL COMMENT 'IPv6 address of the AFTR (Address Family Transition Router)',
  `b4_address_range` VARCHAR(50) NULL COMMENT 'B4 element IPv6 address range',
  `mtu` INT UNSIGNED NOT NULL DEFAULT 1452,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_dslite_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `map_rules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `rule_type` ENUM('map-e','map-t') NOT NULL DEFAULT 'map-e',
  `ipv6_prefix` VARCHAR(50) NOT NULL COMMENT 'MAP IPv6 rule prefix',
  `ipv4_prefix` VARCHAR(50) NOT NULL COMMENT 'MAP IPv4 rule prefix',
  `ea_bits_len` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'EA-bits length',
  `br_address` VARCHAR(45) NOT NULL COMMENT 'Border Relay IPv6 address',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_map_rules_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `xlat464_configs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `plat_prefix` VARCHAR(50) NOT NULL COMMENT 'PLAT (Provider-side translator) prefix',
  `clat_prefix` VARCHAR(50) NULL COMMENT 'CLAT (Customer-side translator) prefix',
  `dns64_prefix` VARCHAR(50) NULL COMMENT 'DNS64 synthesis prefix',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_xlat464_org` (`organization_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
