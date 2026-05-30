-- =============================================================================
-- FireISP 5.0 — Rollback 179: Remove payments.payment_date DEFAULT
-- =============================================================================
-- Reverses migration 179 by dropping the DEFAULT (CURRENT_DATE) added to
-- payments.payment_date.  The column remains NOT NULL.
-- =============================================================================

ALTER TABLE payments
  ALTER COLUMN payment_date DROP DEFAULT;
