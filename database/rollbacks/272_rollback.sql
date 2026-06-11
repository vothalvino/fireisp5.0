-- =============================================================================
-- Rollback 272: Remove Fiber Plant Management tables (§7.4)
-- =============================================================================
-- Drop in FK-safe reverse order.
-- =============================================================================

DROP TABLE IF EXISTS sfp_inventory;
DROP TABLE IF EXISTS otdr_test_results;
DROP TABLE IF EXISTS odf_cross_connects;
DROP TABLE IF EXISTS odf_ports;
DROP TABLE IF EXISTS odf_frames;
DROP TABLE IF EXISTS fiber_routes;
