-- =============================================================================
-- FireISP 5.0 — Rollback 178: Remove invoice_items.amount
-- =============================================================================
-- Reverses migration 178 by dropping the amount column.  The generated `total`
-- column (quantity × unit_price) remains and continues to carry line-item value.
-- =============================================================================

ALTER TABLE invoice_items
  DROP COLUMN amount;
