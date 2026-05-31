-- =============================================================================
-- FireISP 5.0 — Rollback 187: Remove org scope from IPAM/NAS/VLAN tables
-- =============================================================================
-- Reverses migration 187 by dropping the organization_id foreign key, index,
-- and column from nas, ip_pools, ip_assignments, and vlans.  Uses guarded
-- INFORMATION_SCHEMA checks so the rollback is idempotent and safe to re-run.
-- =============================================================================

SET @db_name = DATABASE();

-- NAS ------------------------------------------------------------------------
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'nas'
    AND CONSTRAINT_NAME = 'fk_nas_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE nas DROP FOREIGN KEY fk_nas_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'nas'
    AND INDEX_NAME = 'idx_nas_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_nas_organization_id ON nas', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'nas'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE nas DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- IP pools -------------------------------------------------------------------
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'ip_pools'
    AND CONSTRAINT_NAME = 'fk_ip_pools_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE ip_pools DROP FOREIGN KEY fk_ip_pools_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'ip_pools'
    AND INDEX_NAME = 'idx_ip_pools_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_ip_pools_organization_id ON ip_pools', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'ip_pools'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE ip_pools DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- IP assignments -------------------------------------------------------------
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'ip_assignments'
    AND CONSTRAINT_NAME = 'fk_ip_assignments_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE ip_assignments DROP FOREIGN KEY fk_ip_assignments_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'ip_assignments'
    AND INDEX_NAME = 'idx_ip_assignments_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_ip_assignments_organization_id ON ip_assignments', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'ip_assignments'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE ip_assignments DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- VLANs ----------------------------------------------------------------------
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'vlans'
    AND CONSTRAINT_NAME = 'fk_vlans_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE vlans DROP FOREIGN KEY fk_vlans_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'vlans'
    AND INDEX_NAME = 'idx_vlans_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_vlans_organization_id ON vlans', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'vlans'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE vlans DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
