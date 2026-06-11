-- =============================================================================
-- Migration 242: NAT/CGNAT and PTR (Reverse DNS) Management
-- =============================================================================
-- Implements isp-platform-features.md §5.1 "Dual Stack (IPv4 + IPv6)":
--   Creates nat_pools for CGNAT, 1:1 NAT, and PAT configuration,
--   and ptr_records for reverse DNS (PTR) record management for both
--   IPv4 and IPv6 address space.
--
-- Tables created:
--   nat_pools    — NAT / CGNAT pool definitions
--   ptr_records  — Reverse DNS PTR record registry
-- =============================================================================

CREATE TABLE IF NOT EXISTS `nat_pools` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `nat_type` ENUM('cgnat','1to1','pat') NOT NULL DEFAULT 'cgnat',
  `external_ip_start` VARCHAR(45) NOT NULL,
  `external_ip_end` VARCHAR(45) NOT NULL,
  `internal_subnet` VARCHAR(50) NULL,
  `port_range_start` INT UNSIGNED NULL,
  `port_range_end` INT UNSIGNED NULL,
  `max_ports_per_subscriber` INT UNSIGNED NOT NULL DEFAULT 4096,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_nat_pools_org` (`organization_id`),
  INDEX `idx_nat_pools_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ptr_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `ip_address` VARCHAR(45) NOT NULL,
  `ip_version` ENUM('ipv4','ipv6') NOT NULL DEFAULT 'ipv4',
  `hostname` VARCHAR(255) NOT NULL,
  `ttl` INT UNSIGNED NOT NULL DEFAULT 3600,
  `zone` VARCHAR(255) NULL,
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_ptr_records_org` (`organization_id`),
  INDEX `idx_ptr_records_ip` (`ip_address`),
  INDEX `idx_ptr_records_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
