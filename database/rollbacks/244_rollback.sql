-- =============================================================================
-- Rollback 244: Remove dual-stack session management columns
-- =============================================================================
-- Reverses migration 244. Drop order:
--   1. Drop pppoe_service_profiles IPv6 columns (reverse order of addition).
--   2. Drop radius IPv6 RADIUS attribute columns (table-existence guarded).
--   3. Drop connection_logs IPv6 session columns (NO FK; partitioned table).
-- All operations use stored-procedure guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop pppoe_service_profiles IPv6 columns (reverse order)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_244_drop_pppoe_profiles_ipv6_cols;
DELIMITER //
CREATE PROCEDURE rollback_244_drop_pppoe_profiles_ipv6_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pppoe_service_profiles' AND COLUMN_NAME = 'dns64_prefix'
  ) THEN
    ALTER TABLE pppoe_service_profiles DROP COLUMN dns64_prefix;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pppoe_service_profiles' AND COLUMN_NAME = 'nat64_enabled'
  ) THEN
    ALTER TABLE pppoe_service_profiles DROP COLUMN nat64_enabled;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pppoe_service_profiles' AND COLUMN_NAME = 'dns_secondary_v6'
  ) THEN
    ALTER TABLE pppoe_service_profiles DROP COLUMN dns_secondary_v6;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pppoe_service_profiles' AND COLUMN_NAME = 'dns_primary_v6'
  ) THEN
    ALTER TABLE pppoe_service_profiles DROP COLUMN dns_primary_v6;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pppoe_service_profiles' AND COLUMN_NAME = 'delegated_prefix_len'
  ) THEN
    ALTER TABLE pppoe_service_profiles DROP COLUMN delegated_prefix_len;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pppoe_service_profiles' AND COLUMN_NAME = 'ipv6cp_enabled'
  ) THEN
    ALTER TABLE pppoe_service_profiles DROP COLUMN ipv6cp_enabled;
  END IF;
END //
DELIMITER ;
CALL rollback_244_drop_pppoe_profiles_ipv6_cols();
DROP PROCEDURE IF EXISTS rollback_244_drop_pppoe_profiles_ipv6_cols;

-- ---------------------------------------------------------------------------
-- Drop radius IPv6 RADIUS attribute columns (table-existence guarded)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_244_drop_radius_ipv6_cols;
DELIMITER //
CREATE PROCEDURE rollback_244_drop_radius_ipv6_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'radius'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius' AND COLUMN_NAME = 'framed_ipv6_pool'
    ) THEN
      ALTER TABLE radius DROP COLUMN framed_ipv6_pool;
    END IF;

    IF EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius' AND COLUMN_NAME = 'delegated_ipv6_prefix'
    ) THEN
      ALTER TABLE radius DROP COLUMN delegated_ipv6_prefix;
    END IF;

    IF EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'radius' AND COLUMN_NAME = 'framed_ipv6_address'
    ) THEN
      ALTER TABLE radius DROP COLUMN framed_ipv6_address;
    END IF;
  END IF;
END //
DELIMITER ;
CALL rollback_244_drop_radius_ipv6_cols();
DROP PROCEDURE IF EXISTS rollback_244_drop_radius_ipv6_cols;

-- ---------------------------------------------------------------------------
-- Drop connection_logs IPv6 session columns (partitioned table — NO FK)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_244_drop_connection_logs_ipv6_cols;
DELIMITER //
CREATE PROCEDURE rollback_244_drop_connection_logs_ipv6_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'stack_type'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN stack_type;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'acct_input_octets_v6'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN acct_input_octets_v6;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'acct_output_octets_v6'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN acct_output_octets_v6;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'connection_logs' AND COLUMN_NAME = 'framed_ipv6_prefix'
  ) THEN
    ALTER TABLE connection_logs DROP COLUMN framed_ipv6_prefix;
  END IF;
END //
DELIMITER ;
CALL rollback_244_drop_connection_logs_ipv6_cols();
DROP PROCEDURE IF EXISTS rollback_244_drop_connection_logs_ipv6_cols;
