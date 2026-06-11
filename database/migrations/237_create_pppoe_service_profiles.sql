-- =============================================================================
-- Migration 237: PPPoE Service Profiles (Phase B)
-- =============================================================================
-- Implements isp-platform-features.md §4 "PPPoE Management Phase B":
--   Creates pppoe_service_profiles table for per-profile MTU, DNS, auth-method,
--   rate-limit overrides, and MikroTik address-list/filter-id configuration.
--   Adds service_profile_id to ip_pools and radius tables for profile binding.
--
-- Tables created:
--   pppoe_service_profiles  — PPPoE AC / BNG service profile configuration
--
-- Columns added (stored-procedure guards):
--   ip_pools.service_profile_id   — FK → pppoe_service_profiles(id)
--   radius.service_profile_id     — FK → pppoe_service_profiles(id)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Table: pppoe_service_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pppoe_service_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id BIGINT UNSIGNED NULL,
  name VARCHAR(100) NOT NULL,
  service_name VARCHAR(64) NULL COMMENT 'PPPoE AC service name sent in PADO; must match NAS pppoe-service-name',
  mtu SMALLINT UNSIGNED NOT NULL DEFAULT 1492,
  mru SMALLINT UNSIGNED NOT NULL DEFAULT 1492,
  auth_methods VARCHAR(100) NOT NULL DEFAULT 'pap,chap,mschapv2',
  dns_primary VARCHAR(45) NULL,
  dns_secondary VARCHAR(45) NULL,
  session_timeout_seconds INT NULL,
  idle_timeout_seconds INT NULL,
  rate_limit_override VARCHAR(100) NULL COMMENT 'Vendor rate string; when set replaces plan speed attribute for this profile subscribers',
  address_list VARCHAR(100) NULL COMMENT 'MikroTik firewall address-list name',
  filter_id VARCHAR(100) NULL COMMENT 'RFC 2865 Filter-Id attribute for firewall policy',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_pppoe_service_profiles_org (organization_id),
  KEY idx_pppoe_service_profiles_status (status),
  KEY idx_pppoe_service_profiles_deleted (deleted_at),
  CONSTRAINT fk_pppoe_service_profiles_org FOREIGN KEY (organization_id)
    REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- Column: ip_pools.service_profile_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_237_add_ip_pools_service_profile_id;
DELIMITER //
CREATE PROCEDURE migration_237_add_ip_pools_service_profile_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'ip_pools'
      AND COLUMN_NAME  = 'service_profile_id'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN service_profile_id BIGINT UNSIGNED NULL
        COMMENT 'PPPoE service profile applied to subscribers using this pool'
        AFTER nas_id;
  END IF;
END //
DELIMITER ;
CALL migration_237_add_ip_pools_service_profile_id();
DROP PROCEDURE IF EXISTS migration_237_add_ip_pools_service_profile_id;

-- ---------------------------------------------------------------------------
-- FK: fk_ip_pools_service_profile
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_237_add_fk_ip_pools_service_profile;
DELIMITER //
CREATE PROCEDURE migration_237_add_fk_ip_pools_service_profile()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'ip_pools'
      AND CONSTRAINT_NAME         = 'fk_ip_pools_service_profile'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE ip_pools
      ADD CONSTRAINT fk_ip_pools_service_profile
        FOREIGN KEY (service_profile_id) REFERENCES pppoe_service_profiles (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_237_add_fk_ip_pools_service_profile();
DROP PROCEDURE IF EXISTS migration_237_add_fk_ip_pools_service_profile;

-- ---------------------------------------------------------------------------
-- Column: radius.service_profile_id
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_237_add_radius_service_profile_id;
DELIMITER //
CREATE PROCEDURE migration_237_add_radius_service_profile_id()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
      AND COLUMN_NAME  = 'service_profile_id'
  ) THEN
    ALTER TABLE radius
      ADD COLUMN service_profile_id BIGINT UNSIGNED NULL
        COMMENT 'Per-account PPPoE service profile override; takes precedence over pool-level profile';
  END IF;
END //
DELIMITER ;
CALL migration_237_add_radius_service_profile_id();
DROP PROCEDURE IF EXISTS migration_237_add_radius_service_profile_id;

-- ---------------------------------------------------------------------------
-- FK: fk_radius_service_profile
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_237_add_fk_radius_service_profile;
DELIMITER //
CREATE PROCEDURE migration_237_add_fk_radius_service_profile()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA            = DATABASE()
      AND TABLE_NAME              = 'radius'
      AND CONSTRAINT_NAME         = 'fk_radius_service_profile'
      AND REFERENCED_TABLE_NAME   IS NOT NULL
  ) THEN
    ALTER TABLE radius
      ADD CONSTRAINT fk_radius_service_profile
        FOREIGN KEY (service_profile_id) REFERENCES pppoe_service_profiles (id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_237_add_fk_radius_service_profile();
DROP PROCEDURE IF EXISTS migration_237_add_fk_radius_service_profile;
