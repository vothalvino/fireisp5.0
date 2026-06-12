-- =============================================================================
-- Rollback 309: Drop dashboard_widgets table
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS dashboard_widgets;
SET FOREIGN_KEY_CHECKS = 1;
