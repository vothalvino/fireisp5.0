-- Migration: 051_add_currency_to_financial_tables
-- Description: Multi-currency support. Adds a currency CHAR(3) column (ISO 4217
--              currency code, e.g. 'USD', 'MXN', 'EUR') to the core financial
--              tables so that ISPs serving multiple countries can record the
--              currency each document was issued in.

ALTER TABLE invoices
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE payments
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE credit_notes
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE quotes
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE plans
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';

ALTER TABLE expenses
    ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'USD' COMMENT 'ISO 4217 currency code';
