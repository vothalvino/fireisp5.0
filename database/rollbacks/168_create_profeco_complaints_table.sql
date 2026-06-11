-- =============================================================================
-- FireISP 5.0 — Rollback 168: Drop profeco_complaints table
-- =============================================================================
-- Reverses migration 168.  No other table references profeco_complaints.
-- =============================================================================

DROP TABLE IF EXISTS profeco_complaints;
