-- =============================================================================
-- Migration 421 — record WHICH invoice a payment actually settled
-- =============================================================================
-- payment_transactions.invoice_id (migration 420) is the INTENDED invoice a
-- checkout was created for. It is NOT proof that this transaction transitioned
-- that invoice to 'paid': a duplicate/overpayment reconciles against an
-- already-paid invoice (writes a standing credit, markPaid=false), and legacy
-- charge()/autopay transactions carry no invoice_id at all yet reconcile still
-- pays the oldest matching invoice. Refund reversal needs to re-open EXACTLY the
-- invoice this payment paid — no more, no less — so reconcilePayment now records
-- settled_invoice_id when (and only when) it flips an invoice to 'paid', and
-- reverseRefund keys off it. NULL = this payment settled no invoice (a standing
-- credit / overpayment) → a refund must not re-open anything.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_421_payment_tx_settled_invoice;
DELIMITER //
CREATE PROCEDURE migration_421_payment_tx_settled_invoice()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payment_transactions'
      AND COLUMN_NAME  = 'settled_invoice_id'
  ) THEN
    ALTER TABLE payment_transactions
      ADD COLUMN settled_invoice_id BIGINT UNSIGNED NULL
        COMMENT 'The invoice this payment transitioned to paid (set by reconcile); NULL = settled nothing. Drives refund reversal — migration 421'
        AFTER invoice_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payment_transactions'
      AND INDEX_NAME   = 'idx_payment_transactions_settled_invoice_id'
  ) THEN
    ALTER TABLE payment_transactions
      ADD KEY idx_payment_transactions_settled_invoice_id (settled_invoice_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payment_transactions'
      AND CONSTRAINT_NAME = 'fk_payment_transactions_settled_invoice'
  ) THEN
    ALTER TABLE payment_transactions
      ADD CONSTRAINT fk_payment_transactions_settled_invoice FOREIGN KEY (settled_invoice_id)
        REFERENCES invoices (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END //
DELIMITER ;
CALL migration_421_payment_tx_settled_invoice();
DROP PROCEDURE IF EXISTS migration_421_payment_tx_settled_invoice;
