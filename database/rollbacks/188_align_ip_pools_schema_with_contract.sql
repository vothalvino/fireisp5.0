-- =============================================================================
-- FireISP 5.0 — Rollback 188: Restore the legacy ip_pools.cidr column
-- =============================================================================
-- Reverses migration 188.  The forward migration added subnet_mask and
-- pool_type, back-filled subnet_mask from cidr, swapped the unique key, and
-- DROPPED the cidr column.  This rollback:
--
--   1. Re-adds cidr and back-fills it from subnet_mask using the inverse of
--      the forward computation:
--        IPv4: cidr = BIT_COUNT(INET_ATON(subnet_mask)) — only for rows whose
--              subnet_mask is a valid dotted-decimal contiguous netmask
--              (verified by round-tripping the mask).
--        IPv6: cidr = numeric part of the '/<n>' CIDR string the forward
--              migration wrote.
--   2. Drops uq_ip_pools_network_mask_ver and re-creates
--      uq_ip_pools_network_cidr_ver (only when doing so cannot fail on
--      duplicates).
--   3. Drops the pool_type and subnet_mask columns the migration added.
--
-- IRREVERSIBILITY NOTES:
--   * cidr was originally TINYINT UNSIGNED NOT NULL.  It is re-added as NULL
--     because rows created after migration 188 (or rows whose subnet_mask is
--     free-form text that is not a valid contiguous IPv4 netmask or '/<n>'
--     IPv6 prefix) have no recoverable prefix length and stay NULL.
--   * The original unique key is only re-created when no two rows collapse to
--     the same (network, cidr, ip_version) tuple; otherwise it is skipped so
--     the rollback still succeeds.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_188_restore_ip_pools_cidr;
DELIMITER //
CREATE PROCEDURE rollback_188_restore_ip_pools_cidr()
BEGIN
  -- 1. Re-add the cidr column (nullable — see header)
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools'
      AND COLUMN_NAME = 'cidr'
  ) THEN
    ALTER TABLE ip_pools
      ADD COLUMN cidr TINYINT UNSIGNED NULL
        COMMENT 'CIDR prefix length e.g. 24 (v4) or 48 (v6)'
        AFTER network;
  END IF;

  -- 2. Back-fill cidr from subnet_mask (only while subnet_mask still exists)
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools'
      AND COLUMN_NAME = 'subnet_mask'
  ) THEN
    -- IPv4: dotted-decimal masks; the round-trip comparison guarantees the
    -- mask is a valid contiguous netmask before trusting BIT_COUNT.
    UPDATE ip_pools
    SET cidr = BIT_COUNT(INET_ATON(subnet_mask))
    WHERE cidr IS NULL
      AND ip_version = '4'
      AND subnet_mask REGEXP '^[0-9]{1,3}([.][0-9]{1,3}){3}$'
      AND INET_NTOA((0xFFFFFFFF << (32 - BIT_COUNT(INET_ATON(subnet_mask)))) & 0xFFFFFFFF) = subnet_mask;

    -- IPv6: the forward migration wrote '/<n>' strings.
    UPDATE ip_pools
    SET cidr = CAST(SUBSTRING(subnet_mask, 2) AS UNSIGNED)
    WHERE cidr IS NULL
      AND ip_version = '6'
      AND subnet_mask REGEXP '^/[0-9]{1,3}$'
      AND CAST(SUBSTRING(subnet_mask, 2) AS UNSIGNED) <= 128;
  END IF;

  -- 3. Drop the mask-based unique key added by the migration
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools'
      AND INDEX_NAME = 'uq_ip_pools_network_mask_ver'
  ) THEN
    ALTER TABLE ip_pools DROP INDEX uq_ip_pools_network_mask_ver;
  END IF;

  -- 4. Re-create the original cidr-based unique key, but only when no
  --    duplicate (network, cidr, ip_version) tuples exist (NULL cidr rows
  --    never conflict in a unique index).
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools'
      AND INDEX_NAME = 'uq_ip_pools_network_cidr_ver'
  ) AND NOT EXISTS (
    SELECT 1
    FROM ip_pools
    WHERE cidr IS NOT NULL
    GROUP BY network, cidr, ip_version
    HAVING COUNT(*) > 1
  ) THEN
    ALTER TABLE ip_pools
      ADD UNIQUE KEY uq_ip_pools_network_cidr_ver (network, cidr, ip_version);
  END IF;

  -- 5. Drop the pool_type column added by the migration
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools'
      AND COLUMN_NAME = 'pool_type'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN pool_type;
  END IF;

  -- 6. Drop the subnet_mask column added by the migration
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ip_pools'
      AND COLUMN_NAME = 'subnet_mask'
  ) THEN
    ALTER TABLE ip_pools DROP COLUMN subnet_mask;
  END IF;
END //
DELIMITER ;
CALL rollback_188_restore_ip_pools_cidr();
DROP PROCEDURE IF EXISTS rollback_188_restore_ip_pools_cidr;
