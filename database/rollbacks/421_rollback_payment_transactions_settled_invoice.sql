-- Rollback 421 — drop payment_transactions.settled_invoice_id (FK, index, column).
DROP PROCEDURE IF EXISTS rollback_421_payment_tx_settled_invoice;
DELIMITER //
CREATE PROCEDURE rollback_421_payment_tx_settled_invoice()
BEGIN
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions'
      AND CONSTRAINT_NAME = 'fk_payment_transactions_settled_invoice') THEN
    ALTER TABLE payment_transactions DROP FOREIGN KEY fk_payment_transactions_settled_invoice;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions'
      AND INDEX_NAME = 'idx_payment_transactions_settled_invoice_id') THEN
    ALTER TABLE payment_transactions DROP INDEX idx_payment_transactions_settled_invoice_id;
  END IF;
  IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions'
      AND COLUMN_NAME = 'settled_invoice_id') THEN
    ALTER TABLE payment_transactions DROP COLUMN settled_invoice_id;
  END IF;
END //
DELIMITER ;
CALL rollback_421_payment_tx_settled_invoice();
DROP PROCEDURE IF EXISTS rollback_421_payment_tx_settled_invoice;
