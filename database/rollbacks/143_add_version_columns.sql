-- =============================================================================
-- FireISP 5.0 — Rollback 143: Remove version columns (optimistic locking)
-- =============================================================================
-- Reverses migration 143.
-- =============================================================================

ALTER TABLE invoices DROP COLUMN version;
ALTER TABLE contracts DROP COLUMN version;
ALTER TABLE payments DROP COLUMN version;
ALTER TABLE clients DROP COLUMN version;
