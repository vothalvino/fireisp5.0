-- =============================================================================
-- Migration 278: CPE Inventory — Lifecycle, Subscriber Link, Swap, Depreciation (§8.4)
-- =============================================================================
-- Schema changes to cpe_devices (guarded ALTER procedures):
--   lifecycle_state  — ENUM in_stock|assigned|active|returned|rma
--   subscriber_id    — FK to clients (auto-link on Inform match)
--   subscriber_linked_at — when link was established
--   purchase_cost    — DECIMAL for depreciation
--   purchase_date    — DATE for depreciation start
--   depreciation_method — ENUM straight_line|declining_balance|none
--   useful_life_months  — INT for straight-line calculation
--   salvage_value    — DECIMAL residual value at end of life
-- New table:
--   cpe_lifecycle_history — immutable audit trail of lifecycle state transitions
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add lifecycle_state column to cpe_devices
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _mig278_add_lifecycle_state;

DELIMITER //
CREATE PROCEDURE _mig278_add_lifecycle_state()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND COLUMN_NAME = 'lifecycle_state'
  ) THEN
    ALTER TABLE cpe_devices
      ADD COLUMN lifecycle_state ENUM('in_stock','assigned','active','returned','rma')
        NOT NULL DEFAULT 'in_stock'
        COMMENT 'CPE lifecycle: in_stock→assigned→active→returned|rma'
        AFTER notes;
  END IF;
END
//
DELIMITER ;

CALL _mig278_add_lifecycle_state();
DROP PROCEDURE IF EXISTS _mig278_add_lifecycle_state;

-- ---------------------------------------------------------------------------
-- 2. Add subscriber_id and subscriber_linked_at
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _mig278_add_subscriber_link;

DELIMITER //
CREATE PROCEDURE _mig278_add_subscriber_link()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND COLUMN_NAME = 'subscriber_id'
  ) THEN
    ALTER TABLE cpe_devices
      ADD COLUMN subscriber_id BIGINT UNSIGNED NULL
        COMMENT 'FK to clients — subscriber this CPE is assigned to'
        AFTER lifecycle_state,
      ADD COLUMN subscriber_linked_at DATETIME NULL
        COMMENT 'When subscriber_id was last set (auto-link or manual)'
        AFTER subscriber_id,
      ADD KEY idx_cpe_devices_subscriber (subscriber_id),
      ADD CONSTRAINT fk_cpe_devices_subscriber
        FOREIGN KEY (subscriber_id) REFERENCES clients(id)
        ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
//
DELIMITER ;

CALL _mig278_add_subscriber_link();
DROP PROCEDURE IF EXISTS _mig278_add_subscriber_link;

-- ---------------------------------------------------------------------------
-- 3. Add depreciation tracking columns
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS _mig278_add_depreciation_cols;

DELIMITER //
CREATE PROCEDURE _mig278_add_depreciation_cols()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cpe_devices'
      AND COLUMN_NAME = 'purchase_cost'
  ) THEN
    ALTER TABLE cpe_devices
      ADD COLUMN purchase_cost      DECIMAL(12,2) NULL
        COMMENT 'Original purchase cost for depreciation calculation'
        AFTER subscriber_linked_at,
      ADD COLUMN purchase_date      DATE NULL
        COMMENT 'Purchase date — depreciation start'
        AFTER purchase_cost,
      ADD COLUMN depreciation_method ENUM('straight_line','declining_balance','none') NOT NULL DEFAULT 'none'
        COMMENT 'Depreciation method applied to this device'
        AFTER purchase_date,
      ADD COLUMN useful_life_months  SMALLINT UNSIGNED NULL DEFAULT 60
        COMMENT 'Expected useful life in months (straight-line denominator)'
        AFTER depreciation_method,
      ADD COLUMN salvage_value       DECIMAL(12,2) NULL DEFAULT 0.00
        COMMENT 'Residual/salvage value at end of useful life'
        AFTER useful_life_months;
  END IF;
END
//
DELIMITER ;

CALL _mig278_add_depreciation_cols();
DROP PROCEDURE IF EXISTS _mig278_add_depreciation_cols;

-- ---------------------------------------------------------------------------
-- 4. Table: cpe_lifecycle_history
-- Immutable log of lifecycle state transitions (created, never updated or deleted).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cpe_lifecycle_history (
    id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    organization_id     BIGINT UNSIGNED NULL,
    cpe_device_id       BIGINT UNSIGNED NOT NULL,
    from_state          ENUM('in_stock','assigned','active','returned','rma') NULL
        COMMENT 'NULL for the initial record (device created)',
    to_state            ENUM('in_stock','assigned','active','returned','rma') NOT NULL,
    reason              VARCHAR(255)    NULL COMMENT 'Human-readable reason: swap, decommission, return, etc.',
    swap_in_device_id   BIGINT UNSIGNED NULL COMMENT 'For swap events: the device being swapped IN (new)',
    swap_out_device_id  BIGINT UNSIGNED NULL COMMENT 'For swap events: the device being swapped OUT (old)',
    performed_by        BIGINT UNSIGNED NULL COMMENT 'FK to users — who performed the transition',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cpe_lh_org (organization_id),
    KEY idx_cpe_lh_device (cpe_device_id),
    KEY idx_cpe_lh_created_at (created_at),
    CONSTRAINT fk_cpe_lh_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_cpe_lh_device FOREIGN KEY (cpe_device_id) REFERENCES cpe_devices(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Immutable lifecycle state transition audit trail per CPE device (§8.4)';

-- ---------------------------------------------------------------------------
-- 5. Seed permissions for §8.4
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO permissions (name, display_name, module) VALUES
    ('cpe_inventory.view',          'View CPE Inventory',               'network'),
    ('cpe_inventory.manage',        'Manage CPE Inventory Lifecycle',   'network'),
    ('cpe_inventory.swap',          'Execute CPE Swap Workflow',        'network'),
    ('cpe_inventory.link',          'Link/Unlink CPE Subscriber',       'network'),
    ('cpe_lifecycle_history.view',  'View CPE Lifecycle History',       'network');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.name IN (
    'cpe_inventory.view', 'cpe_inventory.manage', 'cpe_inventory.swap',
    'cpe_inventory.link', 'cpe_lifecycle_history.view'
)
WHERE r.name = 'admin';
