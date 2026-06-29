-- =============================================================================
-- Rollback 367 — (no-op) orphaned payment-credit cleanup is not reversible
-- =============================================================================
-- Migration 367 DELETED client_balance_ledger 'payment' credits whose payment no
-- longer exists (a one-time data correction). Those rows cannot be reconstructed,
-- so this rollback is an intentional no-op: it only lets the runner un-track the
-- migration. Re-applying migration 367 afterwards is safe and idempotent — it
-- simply re-deletes any orphans (zero rows if already clean).
SELECT 1;
