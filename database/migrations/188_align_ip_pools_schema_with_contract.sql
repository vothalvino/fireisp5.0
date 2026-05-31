-- Migration: 188_align_ip_pools_schema_with_contract
-- Description: Aligns the ip_pools table with the authoritative application
--   contract (src/models/IpPool.js fillable, src/middleware/schemas/ipPools.js,
--   the generated docs/openapi.json, and frontend/src/pages/IpPoolList.tsx).
--   The table drifted from the columns the code actually reads and writes:
--
--     * The code stores the network mask as a free-form string `subnet_mask`
--       (frontend placeholder "e.g. 255.255.255.0"), but the DB only had a
--       numeric `cidr` (TINYINT, NOT NULL, no default) prefix length. Because
--       `cidr` was NOT NULL with no default and the create path never supplies
--       it, real-DB inserts failed with "Field 'cidr' doesn't have a default
--       value" even though the unit tests (which mock db.query) passed.
--     * The code reads/writes a `pool_type` string (e.g. "dynamic", "static")
--       that had no column at all, so real-DB writes failed with
--       "Unknown column 'pool_type'".
--
--   Data-semantics decision: `subnet_mask` (a dotted-decimal / CIDR string) is
--   the canonical mask field the application uses, so this migration makes it
--   the source of truth and drops the now-redundant numeric `cidr` column.
--   Existing `cidr` values are converted to a dotted-decimal netmask for IPv4
--   pools and to CIDR prefix notation ("/<n>") for IPv6 pools so no data is
--   lost. The old uniqueness guarantee (one pool per network/prefix/version)
--   is preserved by recreating the unique key on (network, subnet_mask,
--   ip_version), which is 1:1 with the previous (network, cidr, ip_version).
--
--   Each step is guarded on INFORMATION_SCHEMA so the migration is idempotent.

SET @db_name = DATABASE();

-- ---------------------------------------------------------------------------
-- 1. Add subnet_mask (nullable, matches validation schema max 45).
-- ---------------------------------------------------------------------------
SET @has_subnet_mask = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND COLUMN_NAME = 'subnet_mask'
);
SET @sql = IF(
  @has_subnet_mask = 0,
  'ALTER TABLE ip_pools ADD COLUMN subnet_mask VARCHAR(45) NULL COMMENT ''Network mask, dotted-decimal (IPv4) or CIDR notation'' AFTER network',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. Back-fill subnet_mask from the legacy cidr prefix (only while cidr still
--    exists and subnet_mask has not yet been populated).
-- ---------------------------------------------------------------------------
SET @has_cidr = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND COLUMN_NAME = 'cidr'
);
SET @sql = IF(
  @has_cidr = 1,
  'UPDATE ip_pools SET subnet_mask = CASE WHEN ip_version = ''6'' THEN CONCAT(''/'', cidr) ELSE INET_NTOA((0xFFFFFFFF << (32 - cidr)) & 0xFFFFFFFF) END WHERE subnet_mask IS NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3. Add pool_type (nullable, matches validation schema max 50).
-- ---------------------------------------------------------------------------
SET @has_pool_type = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND COLUMN_NAME = 'pool_type'
);
SET @sql = IF(
  @has_pool_type = 0,
  'ALTER TABLE ip_pools ADD COLUMN pool_type VARCHAR(50) NULL COMMENT ''Allocation type e.g. dynamic, static'' AFTER gateway',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 4. Drop the cidr-based unique key (it references the column being removed).
-- ---------------------------------------------------------------------------
SET @has_old_uq = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND INDEX_NAME = 'uq_ip_pools_network_cidr_ver'
);
SET @sql = IF(
  @has_old_uq > 0,
  'ALTER TABLE ip_pools DROP INDEX uq_ip_pools_network_cidr_ver',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 5. Drop the legacy cidr column.
-- ---------------------------------------------------------------------------
SET @sql = IF(
  @has_cidr = 1,
  'ALTER TABLE ip_pools DROP COLUMN cidr',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 6. Recreate the natural uniqueness guarantee on the contract columns.
-- ---------------------------------------------------------------------------
SET @has_new_uq = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'ip_pools'
    AND INDEX_NAME = 'uq_ip_pools_network_mask_ver'
);
SET @sql = IF(
  @has_new_uq = 0,
  'ALTER TABLE ip_pools ADD UNIQUE KEY uq_ip_pools_network_mask_ver (network, subnet_mask, ip_version)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
