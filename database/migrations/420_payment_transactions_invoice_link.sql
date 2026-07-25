-- =============================================================================
-- Migration 420 — link a payment_transaction to the invoice it settles
-- =============================================================================
-- Hosted checkout (and payment links) are ALWAYS for one specific invoice, but
-- that linkage was thrown away: reconcilePayment re-derived the target as "the
-- client's OLDEST issued invoice whose total matches the amount", which (a)
-- settles the WRONG invoice when a client has two same-total open invoices and
-- (b) STRANDS captured money when the oldest invoice's amount differs (the
-- amount check rolled back without crediting). Adding an explicit invoice_id lets
-- reconcile settle exactly the invoice the customer chose. Nullable + ON DELETE
-- SET NULL: legacy charge()/autopay transactions (and pre-migration rows) keep
-- NULL and fall back to the old heuristic.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_420_payment_tx_invoice_link;
DELIMITER //
CREATE PROCEDURE migration_420_payment_tx_invoice_link()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payment_transactions'
      AND COLUMN_NAME  = 'invoice_id'
  ) THEN
    ALTER TABLE payment_transactions
      ADD COLUMN invoice_id BIGINT UNSIGNED NULL
        COMMENT 'The specific invoice this payment settles (checkout/payment-link); NULL = legacy heuristic reconcile'
        AFTER client_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payment_transactions'
      AND INDEX_NAME   = 'idx_payment_transactions_invoice_id'
  ) THEN
    ALTER TABLE payment_transactions
      ADD KEY idx_payment_transactions_invoice_id (invoice_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payment_transactions'
      AND CONSTRAINT_NAME = 'fk_payment_transactions_invoice'
  ) THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT fk_payment_transactions_invoice FOREIGN KEY (invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_420_payment_tx_invoice_link();
DROP PROCEDURE IF EXISTS migration_420_payment_tx_invoice_link;
