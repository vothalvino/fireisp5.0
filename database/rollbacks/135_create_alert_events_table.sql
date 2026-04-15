-- =============================================================================
-- FireISP 5.0 — Rollback 135: Drop alert_events table
-- =============================================================================
-- Reverses migration 135.  Must be rolled back before 134 (FK dependency).
-- =============================================================================

DROP TABLE IF EXISTS alert_events;
