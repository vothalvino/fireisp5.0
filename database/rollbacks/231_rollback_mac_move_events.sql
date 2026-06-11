-- =============================================================================
-- Rollback 231: Drop mac_move_events table
-- =============================================================================
-- Reverses migration 231. The table has no FK constraints referencing other
-- tables, so a plain DROP TABLE IF EXISTS is sufficient.
-- =============================================================================

DROP TABLE IF EXISTS mac_move_events;
