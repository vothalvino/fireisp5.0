-- Migration: 183_add_org_scope_to_network_inventory_tables
-- Description: Adds tenant scoping columns expected by the network,
--              inventory, and topology models.

SET @db_name = DATABASE();

-- Devices --------------------------------------------------------------------
SET @has_devices_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'devices'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_devices_org = 0,
  'ALTER TABLE devices ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE devices d
LEFT JOIN sites s ON s.id = d.site_id
LEFT JOIN clients c ON c.id = d.client_id
LEFT JOIN contracts ct ON ct.id = d.contract_id
SET d.organization_id = COALESCE(d.organization_id, s.organization_id, c.organization_id, ct.organization_id)
WHERE d.organization_id IS NULL;

SET @has_devices_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'devices'
    AND INDEX_NAME = 'idx_devices_organization_id'
);
SET @sql = IF(
  @has_devices_org_idx = 0,
  'CREATE INDEX idx_devices_organization_id ON devices (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_devices_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'devices'
    AND CONSTRAINT_NAME = 'fk_devices_organization'
);
SET @sql = IF(
  @has_devices_org_fk = 0,
  'ALTER TABLE devices ADD CONSTRAINT fk_devices_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Inventory items ------------------------------------------------------------
SET @has_inventory_items_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'inventory_items'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_inventory_items_org = 0,
  'ALTER TABLE inventory_items ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE inventory_items ii
LEFT JOIN (
  SELECT MIN(id) AS organization_id
  FROM organizations
) o ON TRUE
SET ii.organization_id = COALESCE(ii.organization_id, o.organization_id)
WHERE ii.organization_id IS NULL;

SET @has_inventory_items_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'inventory_items'
    AND INDEX_NAME = 'idx_inventory_items_organization_id'
);
SET @sql = IF(
  @has_inventory_items_org_idx = 0,
  'CREATE INDEX idx_inventory_items_organization_id ON inventory_items (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_inventory_items_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'inventory_items'
    AND CONSTRAINT_NAME = 'fk_inventory_items_organization'
);
SET @sql = IF(
  @has_inventory_items_org_fk = 0,
  'ALTER TABLE inventory_items ADD CONSTRAINT fk_inventory_items_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Network links --------------------------------------------------------------
SET @has_network_links_org = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'network_links'
    AND COLUMN_NAME = 'organization_id'
);
SET @sql = IF(
  @has_network_links_org = 0,
  'ALTER TABLE network_links ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE network_links nl
LEFT JOIN devices d ON d.id = nl.device_a_id
SET nl.organization_id = COALESCE(nl.organization_id, d.organization_id)
WHERE nl.organization_id IS NULL;

SET @has_network_links_org_idx = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'network_links'
    AND INDEX_NAME = 'idx_network_links_organization_id'
);
SET @sql = IF(
  @has_network_links_org_idx = 0,
  'CREATE INDEX idx_network_links_organization_id ON network_links (organization_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_network_links_org_fk = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db_name
    AND TABLE_NAME = 'network_links'
    AND CONSTRAINT_NAME = 'fk_network_links_organization'
);
SET @sql = IF(
  @has_network_links_org_fk = 0,
  'ALTER TABLE network_links ADD CONSTRAINT fk_network_links_organization FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
