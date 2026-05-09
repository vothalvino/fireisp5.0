-- Migration: 176_fix_client_balance_ledger
-- Description: Aligns the client_balance_ledger table with billingService code.
--
-- billingService.generateInvoice() and recordPaymentCredit() both INSERT into
-- this table using columns and ENUM values that were never added to the schema:
--
--   1. entry_type ENUM missing 'debit' and 'credit':
--      generateInvoice inserts entry_type='debit'; recordPaymentCredit inserts
--      entry_type='credit'. These values are not present in the original ENUM,
--      so every INSERT is rejected by MySQL strict mode with "Data truncated".
--
--   2. 'amount' column missing:
--      Both functions use `amount` as the single numeric field. The schema
--      instead had separate 'debit' and 'credit' columns. Adding 'amount'
--      (aliased to both debit/credit) lets the existing service code work.
--
--   3. 'currency' column missing:
--      recordPaymentCredit() stores the payment currency (e.g. 'MXN', 'USD').
--
--   4. 'reference_type' column missing:
--      Both functions store a polymorphic type tag ('invoice' or 'payment').
--
--   5. 'entry_date' has no DEFAULT:
--      Neither INSERT provides entry_date; MySQL strict mode rejects that.
--      Adding DEFAULT (CURRENT_DATE) means the column is populated automatically.

-- 1. Expand entry_type ENUM to include 'debit' and 'credit' aliases
ALTER TABLE client_balance_ledger
  MODIFY COLUMN entry_type
    ENUM('invoice','payment','credit_note','adjustment','topup','usage_deduction','debit','credit')
    NOT NULL
    COMMENT 'invoice/usage_deduction/debit = debit entries; payment/topup/credit_note/adjustment/credit = credit entries';

-- 2. Add entry_date DEFAULT so rows without an explicit date still insert
ALTER TABLE client_balance_ledger
  MODIFY COLUMN entry_date DATE NOT NULL DEFAULT (CURRENT_DATE)
    COMMENT 'Accounting date of this ledger entry';

-- 3. Add amount column used by billingService (convenience alias; NOT NULL with default 0)
ALTER TABLE client_balance_ledger
  ADD COLUMN amount DECIMAL(10, 2) NOT NULL DEFAULT 0.00
    COMMENT 'Convenience field used by billingService; mirrors the debit or credit value'
    AFTER description;

-- 4. Add currency column used by recordPaymentCredit
ALTER TABLE client_balance_ledger
  ADD COLUMN currency VARCHAR(3) NULL
    COMMENT 'ISO 4217 currency code for the entry (e.g. MXN, USD)'
    AFTER amount;

-- 5. Add reference_type column used by both generateInvoice and recordPaymentCredit
ALTER TABLE client_balance_ledger
  ADD COLUMN reference_type VARCHAR(50) NULL
    COMMENT 'Polymorphic type tag for reference_id (invoice, payment, etc.)'
    AFTER currency;
