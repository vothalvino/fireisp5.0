-- =============================================================================
-- Rollback 392 — Remove cpe_devices.sale_invoice_id
-- =============================================================================
-- MySQL does not support `DROP COLUMN IF EXISTS`; guard via INFORMATION_SCHEMA
-- so the rollback is idempotent. The FK is dropped before the column/key it
-- constrains. Feature A (sellable items in the picker, plan_addons.description)
-- has no schema footprint to roll back — it is app-layer only.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_392_inventory_undo_install_and_sellable_items;
DELIMITER //
CREATE PROCEDURE rollback_392_inventory_undo_install_and_sellable_items()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND CONSTRAINT_NAME = 'fk_cpe_devices_sale_invoice'
  ) THEN
    ALTER TABLE cpe_devices DROP FOREIGN KEY fk_cpe_devices_sale_invoice;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'cpe_devices'
      AND COLUMN_NAME  = 'sale_invoice_id'
  ) THEN
    ALTER TABLE cpe_devices DROP KEY idx_cpe_devices_sale_invoice, DROP COLUMN sale_invoice_id;
  END IF;
END //
DELIMITER ;
CALL rollback_392_inventory_undo_install_and_sellable_items();
DROP PROCEDURE IF EXISTS rollback_392_inventory_undo_install_and_sellable_items;
