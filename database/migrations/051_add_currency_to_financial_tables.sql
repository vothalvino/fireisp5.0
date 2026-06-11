-- Migration: 051_add_currency_to_financial_tables
-- Description: Multi-currency support. Adds a currency CHAR(3) column (ISO 4217
--              currency code, e.g. 'USD', 'MXN', 'EUR') to the core financial
--              tables so that ISPs serving multiple countries can record the
--              currency each document was issued in.
--
--              All column additions use stored-procedure IF NOT EXISTS guards
--              (MySQL does not support ADD COLUMN IF NOT EXISTS) so the file is
--              safe to re-run after a mid-file failure.

-- ---------------------------------------------------------------------------
-- Column: invoices.currency
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_051_add_invoices_currency;
DELIMITER //
CREATE PROCEDURE migration_051_add_invoices_currency()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE invoices
        ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';
  END IF;
END //
DELIMITER ;
CALL migration_051_add_invoices_currency();
DROP PROCEDURE IF EXISTS migration_051_add_invoices_currency;

-- ---------------------------------------------------------------------------
-- Column: payments.currency
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_051_add_payments_currency;
DELIMITER //
CREATE PROCEDURE migration_051_add_payments_currency()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'payments'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE payments
        ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';
  END IF;
END //
DELIMITER ;
CALL migration_051_add_payments_currency();
DROP PROCEDURE IF EXISTS migration_051_add_payments_currency;

-- ---------------------------------------------------------------------------
-- Column: credit_notes.currency
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_051_add_credit_notes_currency;
DELIMITER //
CREATE PROCEDURE migration_051_add_credit_notes_currency()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_notes'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE credit_notes
        ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';
  END IF;
END //
DELIMITER ;
CALL migration_051_add_credit_notes_currency();
DROP PROCEDURE IF EXISTS migration_051_add_credit_notes_currency;

-- ---------------------------------------------------------------------------
-- Column: quotes.currency
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_051_add_quotes_currency;
DELIMITER //
CREATE PROCEDURE migration_051_add_quotes_currency()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE quotes
        ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';
  END IF;
END //
DELIMITER ;
CALL migration_051_add_quotes_currency();
DROP PROCEDURE IF EXISTS migration_051_add_quotes_currency;

-- ---------------------------------------------------------------------------
-- Column: plans.currency
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_051_add_plans_currency;
DELIMITER //
CREATE PROCEDURE migration_051_add_plans_currency()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'plans'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE plans
        ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';
  END IF;
END //
DELIMITER ;
CALL migration_051_add_plans_currency();
DROP PROCEDURE IF EXISTS migration_051_add_plans_currency;

-- ---------------------------------------------------------------------------
-- Column: expenses.currency
-- ---------------------------------------------------------------------------
DROP PROCEDURE IF EXISTS migration_051_add_expenses_currency;
DELIMITER //
CREATE PROCEDURE migration_051_add_expenses_currency()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'expenses'
      AND COLUMN_NAME  = 'currency'
  ) THEN
    ALTER TABLE expenses
        ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';
  END IF;
END //
DELIMITER ;
CALL migration_051_add_expenses_currency();
DROP PROCEDURE IF EXISTS migration_051_add_expenses_currency;
