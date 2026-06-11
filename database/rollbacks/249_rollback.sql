-- =============================================================================
-- Rollback 249: Remove device group tables
-- =============================================================================
-- Reverses migration 249.
-- device_group_members must be dropped before device_groups (FK dependency).
-- =============================================================================

DROP TABLE IF EXISTS device_group_members;
DROP TABLE IF EXISTS device_groups;
