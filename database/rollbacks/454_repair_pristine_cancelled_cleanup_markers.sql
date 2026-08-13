-- =============================================================================
-- Rollback 454 — intentionally preserve the data repair
-- =============================================================================
-- Migration 454 changes no schema.  Re-introducing cleanup markers during a
-- rollback would falsely block contracts that were proven to have no external
-- access, and later network/accounting changes would make the original repair
-- set impossible to reconstruct safely.  Leave the corrected data intact.

SELECT 1 AS pristine_cancelled_cleanup_repair_preserved;
