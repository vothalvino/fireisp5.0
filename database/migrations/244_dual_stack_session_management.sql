-- =============================================================================
-- Migration 244: Dual-Stack Session Management
-- =============================================================================
-- Implements isp-platform-features.md §5 "Dual Stack (IPv4 + IPv6)":
--   Extends pppoe_service_profiles with IPv6CP, DHCPv6-PD, NAT64/DNS64 fields.
--   Extends radius table with IPv6 RADIUS attributes.
--   Extends connection_logs with IPv6 session accounting columns.
--
-- Columns added to pppoe_service_profiles (stored-procedure guards):
--   ipv6cp_enabled        TINYINT(1) NOT NULL DEFAULT 0
--   delegated_prefix_len  TINYINT UNSIGNED NULL
--   dns_primary_v6        VARCHAR(45) NULL
--   dns_secondary_v6      VARCHAR(45) NULL
--   nat64_enabled         TINYINT(1) NOT NULL DEFAULT 0
--   dns64_prefix          VARCHAR(50) NULL
--
-- Columns added to radius (stored-procedure guards, table-existence check):
--   framed_ipv6_address   VARCHAR(45) NULL
--   delegated_ipv6_prefix VARCHAR(50) NULL
--   framed_ipv6_pool      VARCHAR(64) NULL
--
-- Columns added to connection_logs (stored-procedure guards, NO FK):
--   framed_ipv6_prefix      VARCHAR(50) NULL
--   acct_output_octets_v6   BIGINT UNSIGNED NULL
--   acct_input_octets_v6    BIGINT UNSIGNED NULL
--   stack_type              ENUM('ipv4','ipv6','dual') NULL
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Column: pppoe_service_profiles.ipv6cp_enabled
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_ipv6cp_enabled;
DELIMITER //
CREATE PROCEDURE migration_244_add_pppoe_profiles_ipv6cp_enabled()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'pppoe_service_profiles'
      AND COLUMN_NAME  = 'ipv6cp_enabled'
  ) THEN
    ALTER TABLE pppoe_service_profiles
      ADD COLUMN ipv6cp_enabled TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Enable IPv6CP negotiation'
        AFTER filter_id;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_pppoe_profiles_ipv6cp_enabled();
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_ipv6cp_enabled;

-- ---------------------------------------------------------------------------
-- Column: pppoe_service_profiles.delegated_prefix_len
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_delegated_prefix_len;
DELIMITER //
CREATE PROCEDURE migration_244_add_pppoe_profiles_delegated_prefix_len()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'pppoe_service_profiles'
      AND COLUMN_NAME  = 'delegated_prefix_len'
  ) THEN
    ALTER TABLE pppoe_service_profiles
      ADD COLUMN delegated_prefix_len TINYINT UNSIGNED NULL
        COMMENT 'DHCPv6-PD prefix length to delegate (e.g. 56, 60, 64)'
        AFTER ipv6cp_enabled;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_pppoe_profiles_delegated_prefix_len();
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_delegated_prefix_len;

-- ---------------------------------------------------------------------------
-- Column: pppoe_service_profiles.dns_primary_v6
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_dns_primary_v6;
DELIMITER //
CREATE PROCEDURE migration_244_add_pppoe_profiles_dns_primary_v6()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'pppoe_service_profiles'
      AND COLUMN_NAME  = 'dns_primary_v6'
  ) THEN
    ALTER TABLE pppoe_service_profiles
      ADD COLUMN dns_primary_v6 VARCHAR(45) NULL
        COMMENT 'Primary IPv6 DNS server'
        AFTER delegated_prefix_len;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_pppoe_profiles_dns_primary_v6();
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_dns_primary_v6;

-- ---------------------------------------------------------------------------
-- Column: pppoe_service_profiles.dns_secondary_v6
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_dns_secondary_v6;
DELIMITER //
CREATE PROCEDURE migration_244_add_pppoe_profiles_dns_secondary_v6()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'pppoe_service_profiles'
      AND COLUMN_NAME  = 'dns_secondary_v6'
  ) THEN
    ALTER TABLE pppoe_service_profiles
      ADD COLUMN dns_secondary_v6 VARCHAR(45) NULL
        COMMENT 'Secondary IPv6 DNS server'
        AFTER dns_primary_v6;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_pppoe_profiles_dns_secondary_v6();
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_dns_secondary_v6;

-- ---------------------------------------------------------------------------
-- Column: pppoe_service_profiles.nat64_enabled
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_nat64_enabled;
DELIMITER //
CREATE PROCEDURE migration_244_add_pppoe_profiles_nat64_enabled()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'pppoe_service_profiles'
      AND COLUMN_NAME  = 'nat64_enabled'
  ) THEN
    ALTER TABLE pppoe_service_profiles
      ADD COLUMN nat64_enabled TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Enable NAT64 for this profile'
        AFTER dns_secondary_v6;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_pppoe_profiles_nat64_enabled();
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_nat64_enabled;

-- ---------------------------------------------------------------------------
-- Column: pppoe_service_profiles.dns64_prefix
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_dns64_prefix;
DELIMITER //
CREATE PROCEDURE migration_244_add_pppoe_profiles_dns64_prefix()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'pppoe_service_profiles'
      AND COLUMN_NAME  = 'dns64_prefix'
  ) THEN
    ALTER TABLE pppoe_service_profiles
      ADD COLUMN dns64_prefix VARCHAR(50) NULL
        COMMENT 'DNS64 synthesis prefix (e.g. 64:ff9b::/96)'
        AFTER nat64_enabled;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_pppoe_profiles_dns64_prefix();
DROP PROCEDURE IF EXISTS migration_244_add_pppoe_profiles_dns64_prefix;

-- ---------------------------------------------------------------------------
-- Column: radius.framed_ipv6_address
-- (Guarded by INFORMATION_SCHEMA.TABLES check — radius table may not exist.)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_radius_framed_ipv6_address;
DELIMITER //
CREATE PROCEDURE migration_244_add_radius_framed_ipv6_address()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'radius'
        AND COLUMN_NAME  = 'framed_ipv6_address'
    ) THEN
      ALTER TABLE radius
        ADD COLUMN framed_ipv6_address VARCHAR(45) NULL
          COMMENT 'Framed-IPv6-Address RADIUS attribute'
          AFTER framed_ip_address;
    END IF;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_radius_framed_ipv6_address();
DROP PROCEDURE IF EXISTS migration_244_add_radius_framed_ipv6_address;

-- ---------------------------------------------------------------------------
-- Column: radius.delegated_ipv6_prefix
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_radius_delegated_ipv6_prefix;
DELIMITER //
CREATE PROCEDURE migration_244_add_radius_delegated_ipv6_prefix()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'radius'
        AND COLUMN_NAME  = 'delegated_ipv6_prefix'
    ) THEN
      ALTER TABLE radius
        ADD COLUMN delegated_ipv6_prefix VARCHAR(50) NULL
          COMMENT 'Delegated-IPv6-Prefix RADIUS attribute'
          AFTER framed_ipv6_address;
    END IF;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_radius_delegated_ipv6_prefix();
DROP PROCEDURE IF EXISTS migration_244_add_radius_delegated_ipv6_prefix;

-- ---------------------------------------------------------------------------
-- Column: radius.framed_ipv6_pool
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_radius_framed_ipv6_pool;
DELIMITER //
CREATE PROCEDURE migration_244_add_radius_framed_ipv6_pool()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME   = 'radius'
        AND COLUMN_NAME  = 'framed_ipv6_pool'
    ) THEN
      ALTER TABLE radius
        ADD COLUMN framed_ipv6_pool VARCHAR(64) NULL
          COMMENT 'Framed-IPv6-Pool RADIUS attribute'
          AFTER delegated_ipv6_prefix;
    END IF;
  END IF;
END //
DELIMITER ;
CALL migration_244_add_radius_framed_ipv6_pool();
DROP PROCEDURE IF EXISTS migration_244_add_radius_framed_ipv6_pool;

-- ---------------------------------------------------------------------------
-- Column: connection_logs.framed_ipv6_prefix
-- (Partitioned table — NO FK; INFORMATION_SCHEMA guard only.)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_framed_ipv6_prefix;
DELIMITER //
CREATE PROCEDURE migration_244_add_connection_logs_framed_ipv6_prefix()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'framed_ipv6_prefix'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN framed_ipv6_prefix VARCHAR(50) NULL
        COMMENT 'IPv6 prefix assigned to subscriber session';
  END IF;
END //
DELIMITER ;
CALL migration_244_add_connection_logs_framed_ipv6_prefix();
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_framed_ipv6_prefix;

-- ---------------------------------------------------------------------------
-- Column: connection_logs.acct_output_octets_v6
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_acct_output_octets_v6;
DELIMITER //
CREATE PROCEDURE migration_244_add_connection_logs_acct_output_octets_v6()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'acct_output_octets_v6'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN acct_output_octets_v6 BIGINT UNSIGNED NULL
        COMMENT 'IPv6 output (egress) octets for this session';
  END IF;
END //
DELIMITER ;
CALL migration_244_add_connection_logs_acct_output_octets_v6();
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_acct_output_octets_v6;

-- ---------------------------------------------------------------------------
-- Column: connection_logs.acct_input_octets_v6
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_acct_input_octets_v6;
DELIMITER //
CREATE PROCEDURE migration_244_add_connection_logs_acct_input_octets_v6()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'acct_input_octets_v6'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN acct_input_octets_v6 BIGINT UNSIGNED NULL
        COMMENT 'IPv6 input (ingress) octets for this session';
  END IF;
END //
DELIMITER ;
CALL migration_244_add_connection_logs_acct_input_octets_v6();
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_acct_input_octets_v6;

-- ---------------------------------------------------------------------------
-- Column: connection_logs.stack_type
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_stack_type;
DELIMITER //
CREATE PROCEDURE migration_244_add_connection_logs_stack_type()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'connection_logs'
      AND COLUMN_NAME  = 'stack_type'
  ) THEN
    ALTER TABLE connection_logs
      ADD COLUMN stack_type ENUM('ipv4','ipv6','dual') NULL
        COMMENT 'IP stack type for this session';
  END IF;
END //
DELIMITER ;
CALL migration_244_add_connection_logs_stack_type();
DROP PROCEDURE IF EXISTS migration_244_add_connection_logs_stack_type;
