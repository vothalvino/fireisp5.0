-- =============================================================================
-- Rollback 390 — Remove inventory product linkage, restore negative-stock guard
-- =============================================================================
-- MySQL does not support `DROP COLUMN IF EXISTS`; guard via INFORMATION_SCHEMA
-- so the rollback is idempotent and parses on MySQL 8. FKs are dropped before
-- the columns/keys they constrain.

DROP PROCEDURE IF EXISTS rollback_390_inventory_product_linkage;
DELIMITER //
CREATE PROCEDURE rollback_390_inventory_product_linkage()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND CONSTRAINT_NAME = 'fk_quotes_converted_invoice'
  ) THEN
    ALTER TABLE quotes DROP FOREIGN KEY fk_quotes_converted_invoice;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND COLUMN_NAME  = 'converted_invoice_id'
  ) THEN
    ALTER TABLE quotes DROP KEY idx_quotes_converted_invoice, DROP COLUMN converted_invoice_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plan_addons'
      AND CONSTRAINT_NAME = 'fk_plan_addons_inventory_item'
  ) THEN
    ALTER TABLE plan_addons DROP FOREIGN KEY fk_plan_addons_inventory_item;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plan_addons'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE plan_addons DROP KEY idx_plan_addons_inventory_item, DROP COLUMN inventory_item_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoice_items'
      AND CONSTRAINT_NAME = 'fk_invoice_items_inventory_item'
  ) THEN
    ALTER TABLE invoice_items DROP FOREIGN KEY fk_invoice_items_inventory_item;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoice_items'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE invoice_items DROP KEY idx_invoice_items_inventory_item, DROP COLUMN inventory_item_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quote_items'
      AND CONSTRAINT_NAME = 'fk_quote_items_inventory_item'
  ) THEN
    ALTER TABLE quote_items DROP FOREIGN KEY fk_quote_items_inventory_item;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quote_items'
      AND COLUMN_NAME  = 'inventory_item_id'
  ) THEN
    ALTER TABLE quote_items DROP KEY idx_quote_items_inventory_item, DROP COLUMN inventory_item_id;
  END IF;
END //
DELIMITER ;
CALL rollback_390_inventory_product_linkage();
DROP PROCEDURE IF EXISTS rollback_390_inventory_product_linkage;

-- ---------------------------------------------------------------------------
-- Restore the migration-127 negative-stock guard trigger (best-effort — any
-- rows that went negative under Phase 2's drawdown policy while this
-- rollback was applied will violate the trigger on their NEXT update, not
-- retroactively; this only re-enables the guard going forward).
-- ---------------------------------------------------------------------------
DELIMITER $$

DROP TRIGGER IF EXISTS trg_inventory_stock_negative_bu$$

CREATE TRIGGER trg_inventory_stock_negative_bu
BEFORE UPDATE ON inventory_stock
FOR EACH ROW
BEGIN
    IF NEW.quantity < 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Inventory stock quantity cannot be negative';
    END IF;
END$$

DELIMITER ;
