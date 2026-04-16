-- =============================================================================
-- FireISP 5.0 — Rollback 150: Drop outage temporal logic triggers
-- =============================================================================
-- Reverses migration 150.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_outages_temporal_bi;
DROP TRIGGER IF EXISTS trg_outages_temporal_bu;
