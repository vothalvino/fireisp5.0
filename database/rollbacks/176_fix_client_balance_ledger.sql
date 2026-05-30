-- =============================================================================
-- FireISP 5.0 — Rollback 176: Revert client_balance_ledger fixes
-- =============================================================================
-- Reverses migration 176 by dropping the amount, currency, and reference_type
-- columns, removing the entry_date DEFAULT, and restoring the entry_type ENUM
-- to its pre-176 definition.
--
-- NOTE: restoring the narrower entry_type ENUM will fail if any row still uses
-- the 'debit' or 'credit' values; update those rows before rolling back.
-- =============================================================================

ALTER TABLE client_balance_ledger
  DROP COLUMN reference_type,
  DROP COLUMN currency,
  DROP COLUMN amount;

ALTER TABLE client_balance_ledger
  MODIFY COLUMN entry_date DATE NOT NULL
    COMMENT 'Accounting date of this ledger entry';

ALTER TABLE client_balance_ledger
  MODIFY COLUMN entry_type
    ENUM('invoice', 'payment', 'credit_note', 'adjustment', 'topup', 'usage_deduction')
    NOT NULL;
