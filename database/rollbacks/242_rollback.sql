-- =============================================================================
-- Rollback 242: Drop NAT/PTR management tables
-- =============================================================================
-- Reverses migration 242. Tables have no cross-references so either order
-- is safe; ptr_records dropped first for consistency.
-- =============================================================================

DROP TABLE IF EXISTS `ptr_records`;
DROP TABLE IF EXISTS `nat_pools`;
