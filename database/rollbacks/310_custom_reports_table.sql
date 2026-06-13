-- =============================================================================
-- Rollback 310: Drop custom_reports table
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS custom_reports;
SET FOREIGN_KEY_CHECKS = 1;
