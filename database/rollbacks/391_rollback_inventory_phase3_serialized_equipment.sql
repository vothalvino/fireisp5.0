-- =============================================================================
-- Rollback 391 — Remove Inventory Phase 3 serialized-equipment columns
-- =============================================================================
-- MySQL does not support `DROP COLUMN IF EXISTS`; guard via INFORMATION_SCHEMA
-- so the rollback is idempotent. FKs are dropped before the columns/keys they
-- constrain. Restoring cpe_devices.oui to NOT NULL is best-effort: any row a
-- Phase 3 flow left with a NULL oui will fail that ALTER until repaired —
-- this mirrors migration 390's rollback note about the negative-stock trigger
-- (a downgrade after real Phase 3 usage is a manual-repair operation, not a
-- silent one). work_orders.work_type is narrowed back to its pre-391 set;
-- any row already sitting at 'pickup' would be truncated by that MODIFY.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_391_inventory_phase3_serialized_equipment;
DELIMITER //
CREATE PROCEDURE rollback_391_inventory_phase3_serialized_equipment()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND CONSTRAINT_NAME = 'fk_cpe_devices_inventory_item'
  ) THEN
    ALTER TABLE cpe_devices DROP FOREIGN KEY fk_cpe_devices_inventory_item;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND COLUMN_NAME  = 'ownership'
  ) THEN
    ALTER TABLE cpe_devices DROP COLUMN ownership;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE cpe_devices DROP KEY idx_cpe_devices_inventory_item, DROP COLUMN inventory_item_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'inventory_items'
      AND COLUMN_NAME  = 'serial_required'
  ) THEN
    ALTER TABLE inventory_items DROP COLUMN serial_required;
  END IF;
END //
DELIMITER ;
CALL rollback_391_inventory_phase3_serialized_equipment();
DROP PROCEDURE IF EXISTS rollback_391_inventory_phase3_serialized_equipment;

-- ---------------------------------------------------------------------------
-- Best-effort restores (may fail on data written by Phase 3 — see header)
-- ---------------------------------------------------------------------------
ALTER TABLE cpe_devices
  MODIFY COLUMN oui VARCHAR(6) NOT NULL COMMENT 'OUI from CWMP DeviceId.OUI (6 hex chars)';

ALTER TABLE work_orders
  MODIFY COLUMN work_type ENUM('installation','maintenance','repair','survey','other') NOT NULL DEFAULT 'other' COMMENT 'Field-work classification (migrated from jobs.type)';

-- Permission GRANTS are intentionally NOT revoked on rollback — migration 391
-- seeded no new `permissions` rows, only new `role_permissions` grants for
-- slugs that already existed (migrations 276/278). Deleting those grant rows
-- here would silently strip technician/readonly access to features that
-- predate this migration and are unrelated to whether Phase 3's schema
-- columns exist; that's a destructive access change that should be a
-- deliberate decision, not an automatic rollback side effect.
