-- =============================================================================
-- Rollback 243: Remove IPv6 management enhancements
-- =============================================================================
-- Reverses migration 243. Drop order:
--   1. Drop ra_guard_policies table (has FK to devices).
--   2. Drop ip_pools columns (reverse order of addition).
--   3. Drop plans.stack_type column.
-- All column drops use stored-procedure guards.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Drop table: ra_guard_policies
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS `ra_guard_policies`;

-- ---------------------------------------------------------------------------
-- Drop ip_pools columns (reverse order: region_name → dhcpv6_mode)
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_243_drop_ip_pools_cols;
DELIMITER //
CREATE PROCEDURE rollback_243_drop_ip_pools_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'region_name'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN region_name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'slaac_prefix'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN slaac_prefix;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'ra_lifetime_seconds'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN ra_lifetime_seconds;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'ra_other_flag'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN ra_other_flag;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'ra_managed_flag'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN ra_managed_flag;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'ra_enabled'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN ra_enabled;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools' AND COLUMN_NAME = 'dhcpv6_mode'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN dhcpv6_mode;
  END IF;
END //
DELIMITER ;
CALL rollback_243_drop_ip_pools_cols();
DROP PROCEDURE IF EXISTS rollback_243_drop_ip_pools_cols;

-- ---------------------------------------------------------------------------
-- Drop plans.stack_type
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS rollback_243_drop_plans_stack_type;
DELIMITER //
CREATE PROCEDURE rollback_243_drop_plans_stack_type()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'stack_type'
  ) THEN
    ALTER TABLE plans DROP COLUMN stack_type;
  END IF;
END //
DELIMITER ;
CALL rollback_243_drop_plans_stack_type();
DROP PROCEDURE IF EXISTS rollback_243_drop_plans_stack_type;
