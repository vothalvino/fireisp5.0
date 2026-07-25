-- Rollback 420 — drop the payment_transactions.invoice_id linkage (FK, index, column).
DROP PROCEDURE IF EXISTS rollback_420_payment_tx_invoice_link;
DELIMITER //
CREATE PROCEDURE rollback_420_payment_tx_invoice_link()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions'
      AND CONSTRAINT_NAME = 'fk_payment_transactions_invoice'
  ) THEN
    ALTER TABLE payment_transactions DROP FOREIGN KEY fk_payment_transactions_invoice;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions'
      AND INDEX_NAME = 'idx_payment_transactions_invoice_id'
  ) THEN
    ALTER TABLE payment_transactions DROP INDEX idx_payment_transactions_invoice_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payment_transactions'
      AND COLUMN_NAME = 'invoice_id'
  ) THEN
    ALTER TABLE payment_transactions DROP COLUMN invoice_id;
  END IF;
END //
DELIMITER ;
CALL rollback_420_payment_tx_invoice_link();
DROP PROCEDURE IF EXISTS rollback_420_payment_tx_invoice_link;
