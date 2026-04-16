-- =============================================================================
-- FireISP 5.0 — Rollback 130: Drop firerelay_nodes table
-- =============================================================================
-- Reverses migration 130.  Run rollback 131 first (firerelay_client_routing
-- has a FK to this table).
-- =============================================================================

DROP TABLE IF EXISTS firerelay_nodes;
