-- =============================================================================
-- FireISP 5.0 — Rollback 183: Remove org scope from network/inventory tables
-- =============================================================================
-- Reverses migration 183 by dropping the organization_id foreign key, index,
-- and column from devices, inventory_items, and network_links.  Uses guarded
-- INFORMATION_SCHEMA checks so the rollback is idempotent and safe to re-run.
-- =============================================================================

SET @db_name = DATABASE();

-- Devices --------------------------------------------------------------------
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'devices'
    AND CONSTRAINT_NAME = 'fk_devices_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE devices DROP FOREIGN KEY fk_devices_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'devices'
    AND INDEX_NAME = 'idx_devices_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_devices_organization_id ON devices', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'devices'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE devices DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Inventory items ------------------------------------------------------------
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'inventory_items'
    AND CONSTRAINT_NAME = 'fk_inventory_items_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE inventory_items DROP FOREIGN KEY fk_inventory_items_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'inventory_items'
    AND INDEX_NAME = 'idx_inventory_items_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_inventory_items_organization_id ON inventory_items', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'inventory_items'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE inventory_items DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Network links --------------------------------------------------------------
SET @fk = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'network_links'
    AND CONSTRAINT_NAME = 'fk_network_links_organization'
);
SET @sql = IF(@fk > 0,
  'ALTER TABLE network_links DROP FOREIGN KEY fk_network_links_organization', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'network_links'
    AND INDEX_NAME = 'idx_network_links_organization_id'
);
SET @sql = IF(@idx > 0,
  'DROP INDEX idx_network_links_organization_id ON network_links', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'network_links'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(@col > 0,
  'ALTER TABLE network_links DROP COLUMN organization_id', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
