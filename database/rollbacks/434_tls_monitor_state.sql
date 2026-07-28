-- =============================================================================
-- Rollback 434: drop the TLS monitor state table
-- =============================================================================
-- The monitor keeps working; it simply stops noticing that it has been unable
-- to check anything, which is the state migration 434 exists to fix.

DROP TABLE IF EXISTS tls_monitor_state;
