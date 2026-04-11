-- Migration: 127_inventory_stock_negative_guard_trigger
-- Description: Adds a BEFORE UPDATE trigger on inventory_stock that prevents
--              the quantity column from being set to a negative value.
--
--              Without this guard, a stock outbound transaction could silently
--              drive stock below zero, which represents physically impossible
--              inventory state and corrupts downstream reports.
--
--              The trigger raises SQLSTATE '45000' with a descriptive message
--              so the application layer can surface a user-friendly error.
--
--              Uses DROP TRIGGER IF EXISTS before CREATE TRIGGER so the
--              migration is safe to re-run.

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
