-- =============================================================================
-- Rollback 278: Remove CPE Inventory lifecycle changes (§8.4)
-- =============================================================================

-- Remove role_permissions for §8.4 permissions
DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name IN (
    'cpe_inventory.view', 'cpe_inventory.manage', 'cpe_inventory.swap',
    'cpe_inventory.link', 'cpe_lifecycle_history.view'
);

DELETE FROM permissions WHERE name IN (
    'cpe_inventory.view', 'cpe_inventory.manage', 'cpe_inventory.swap',
    'cpe_inventory.link', 'cpe_lifecycle_history.view'
);

-- Drop lifecycle history table
DROP TABLE IF EXISTS cpe_lifecycle_history;

-- Drop depreciation columns
DROP PROCEDURE IF EXISTS _rb278_drop_depreciation_cols;

DELIMITER //
CREATE PROCEDURE _rb278_drop_depreciation_cols()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND COLUMN_NAME = 'purchase_cost'
  ) THEN
    ALTER TABLE cpe_devices
      DROP COLUMN salvage_value,
      DROP COLUMN useful_life_months,
      DROP COLUMN depreciation_method,
      DROP COLUMN purchase_date,
      DROP COLUMN purchase_cost;
  END IF;
END
//
DELIMITER ;

CALL _rb278_drop_depreciation_cols();
DROP PROCEDURE IF EXISTS _rb278_drop_depreciation_cols;

-- Drop subscriber link columns
DROP PROCEDURE IF EXISTS _rb278_drop_subscriber_link;

DELIMITER //
CREATE PROCEDURE _rb278_drop_subscriber_link()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND COLUMN_NAME = 'subscriber_id'
  ) THEN
    ALTER TABLE cpe_devices
      DROP FOREIGN KEY fk_cpe_devices_subscriber,
      DROP KEY idx_cpe_devices_subscriber,
      DROP COLUMN subscriber_linked_at,
      DROP COLUMN subscriber_id;
  END IF;
END
//
DELIMITER ;

CALL _rb278_drop_subscriber_link();
DROP PROCEDURE IF EXISTS _rb278_drop_subscriber_link;

-- Drop lifecycle_state column
DROP PROCEDURE IF EXISTS _rb278_drop_lifecycle_state;

DELIMITER //
CREATE PROCEDURE _rb278_drop_lifecycle_state()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND COLUMN_NAME = 'lifecycle_state'
  ) THEN
    ALTER TABLE cpe_devices DROP COLUMN lifecycle_state;
  END IF;
END
//
DELIMITER ;

CALL _rb278_drop_lifecycle_state();
DROP PROCEDURE IF EXISTS _rb278_drop_lifecycle_state;
