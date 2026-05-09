-- =============================================================================
-- Migration 179 — Fix payments.payment_date: add DEFAULT (CURRENT_DATE)
-- =============================================================================
-- The payments.payment_date column was declared NOT NULL with no DEFAULT.
-- Any INSERT that omits payment_date (e.g. legacy API calls without the field)
-- would be rejected by MySQL strict mode with "Field 'payment_date' doesn't
-- have a default value".  Adding a DEFAULT of CURRENT_DATE makes the column
-- behave sensibly for rows that don't supply an explicit date while keeping
-- the NOT NULL constraint.
-- =============================================================================

ALTER TABLE payments
    ALTER COLUMN payment_date SET DEFAULT (CURRENT_DATE);
