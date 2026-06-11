-- =============================================================================
-- Rollback 245: Drop IPv6 transition mechanism tables
-- =============================================================================
-- Reverses migration 245. Tables have no cross-references so drop order only
-- matters for cleanliness; reversed from creation order.
-- =============================================================================

DROP TABLE IF EXISTS `xlat464_configs`;
DROP TABLE IF EXISTS `map_rules`;
DROP TABLE IF EXISTS `ds_lite_configs`;
DROP TABLE IF EXISTS `tunnel_6rd_configs`;
