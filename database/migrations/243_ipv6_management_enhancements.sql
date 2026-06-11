-- =============================================================================
-- Migration 243: IPv6 Management Enhancements
-- =============================================================================
-- Implements isp-platform-features.md §5 "Dual Stack (IPv4 + IPv6)":
--   Extends ip_pools with DHCPv6, Router Advertisement, SLAAC, and region fields.
--   Extends plans with a stack_type discriminator.
--   Creates ra_guard_policies for RA Guard switch port policy management.
--
-- Columns added to ip_pools (stored-procedure guards):
--   dhcpv6_mode         ENUM('stateful','stateless','slaac') NULL
--   ra_enabled          TINYINT(1) NOT NULL DEFAULT 0
--   ra_managed_flag     TINYINT(1) NOT NULL DEFAULT 0
--   ra_other_flag       TINYINT(1) NOT NULL DEFAULT 0
--   ra_lifetime_seconds INT UNSIGNED NOT NULL DEFAULT 1800
--   slaac_prefix        VARCHAR(50) NULL
--   region_name         VARCHAR(100) NULL
--
-- Columns added to plans (stored-procedure guard):
--   stack_type  ENUM('ipv4_only','ipv6_only','dual_stack') NOT NULL DEFAULT 'dual_stack'
--
-- Tables created:
--   ra_guard_policies — RA Guard policy assignments per switch/port pattern
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Column: ip_pools.dhcpv6_mode
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_dhcpv6_mode;
DELIMITER //
CREATE PROCEDURE migration_243_add_ip_pools_dhcpv6_mode()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'dhcpv6_mode'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN dhcpv6_mode ENUM('stateful','stateless','slaac') NULL
        COMMENT 'DHCPv6 mode for IPv6 pools'
        AFTER last_alerted_threshold;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_ip_pools_dhcpv6_mode();
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_dhcpv6_mode;

-- ---------------------------------------------------------------------------
-- Column: ip_pools.ra_enabled
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_enabled;
DELIMITER //
CREATE PROCEDURE migration_243_add_ip_pools_ra_enabled()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'ra_enabled'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN ra_enabled TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Enable Router Advertisements for this pool'
        AFTER dhcpv6_mode;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_ip_pools_ra_enabled();
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_enabled;

-- ---------------------------------------------------------------------------
-- Column: ip_pools.ra_managed_flag
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_managed_flag;
DELIMITER //
CREATE PROCEDURE migration_243_add_ip_pools_ra_managed_flag()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'ra_managed_flag'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN ra_managed_flag TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Set M flag in RA (managed address config)'
        AFTER ra_enabled;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_ip_pools_ra_managed_flag();
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_managed_flag;

-- ---------------------------------------------------------------------------
-- Column: ip_pools.ra_other_flag
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_other_flag;
DELIMITER //
CREATE PROCEDURE migration_243_add_ip_pools_ra_other_flag()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'ra_other_flag'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN ra_other_flag TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Set O flag in RA (other config)'
        AFTER ra_managed_flag;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_ip_pools_ra_other_flag();
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_other_flag;

-- ---------------------------------------------------------------------------
-- Column: ip_pools.ra_lifetime_seconds
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_lifetime_seconds;
DELIMITER //
CREATE PROCEDURE migration_243_add_ip_pools_ra_lifetime_seconds()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'ra_lifetime_seconds'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN ra_lifetime_seconds INT UNSIGNED NOT NULL DEFAULT 1800
        COMMENT 'RA router lifetime in seconds'
        AFTER ra_other_flag;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_ip_pools_ra_lifetime_seconds();
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_ra_lifetime_seconds;

-- ---------------------------------------------------------------------------
-- Column: ip_pools.slaac_prefix
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_slaac_prefix;
DELIMITER //
CREATE PROCEDURE migration_243_add_ip_pools_slaac_prefix()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'slaac_prefix'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN slaac_prefix VARCHAR(50) NULL
        COMMENT 'IPv6 prefix for SLAAC advertisement'
        AFTER ra_lifetime_seconds;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_ip_pools_slaac_prefix();
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_slaac_prefix;

-- ---------------------------------------------------------------------------
-- Column: ip_pools.region_name
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_region_name;
DELIMITER //
CREATE PROCEDURE migration_243_add_ip_pools_region_name()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'region_name'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN region_name VARCHAR(100) NULL
        COMMENT 'Geographic region name for this pool'
        AFTER slaac_prefix;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_ip_pools_region_name();
DROP PROCEDURE IF EXISTS migration_243_add_ip_pools_region_name;

-- ---------------------------------------------------------------------------
-- Column: plans.stack_type
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_243_add_plans_stack_type;
DELIMITER //
CREATE PROCEDURE migration_243_add_plans_stack_type()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'stack_type'
  ) THEN
    ALTER TABLE plans
      ADD COLUMN stack_type ENUM('ipv4_only','ipv6_only','dual_stack') NOT NULL DEFAULT 'dual_stack'
        COMMENT 'IP stack type: IPv4-only, IPv6-only, or dual-stack'
        AFTER status;
  END IF;
END //
DELIMITER ;
CALL migration_243_add_plans_stack_type();
DROP PROCEDURE IF EXISTS migration_243_add_plans_stack_type;

-- ---------------------------------------------------------------------------
-- Table: ra_guard_policies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `ra_guard_policies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `organization_id` BIGINT UNSIGNED NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `switch_id` BIGINT UNSIGNED NULL,
  `port_pattern` VARCHAR(100) NULL COMMENT 'Port pattern e.g. ge-0/0/*',
  `policy_type` ENUM('strict','loose') NOT NULL DEFAULT 'strict',
  `status` ENUM('active','inactive') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_ra_guard_org` (`organization_id`),
  CONSTRAINT `fk_ra_guard_switch`
    FOREIGN KEY (`switch_id`) REFERENCES `devices` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
