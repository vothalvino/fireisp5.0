-- =============================================================================
-- FireISP 5.0 — Rollback 131: Drop firerelay_client_routing table
-- =============================================================================
-- Reverses migration 131.  Must be rolled back before 130 (FK dependency).
-- =============================================================================

DROP TABLE IF EXISTS firerelay_client_routing;
