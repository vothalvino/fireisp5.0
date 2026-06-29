-- =============================================================================
-- Rollback 368 — (no-op) zeroing voided-invoice ledger lines is not reversible
-- =============================================================================
-- Migration 368 deleted the void-reversal credits and overwrote the debit
-- amounts of voided invoices with 0. The original amounts/credit rows cannot be
-- reconstructed, so this rollback is an intentional no-op: it only lets the
-- runner un-track the migration. Re-applying 368 afterwards is safe/idempotent
-- (voided invoices are already at $0, so it changes nothing).
SELECT 1;
