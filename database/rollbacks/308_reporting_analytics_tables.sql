-- =============================================================================
-- Rollback 308: Drop reporting & analytics core tables
-- =============================================================================

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS generated_reports;
DROP TABLE IF EXISTS scheduled_reports;
DROP TABLE IF EXISTS report_definitions;
SET FOREIGN_KEY_CHECKS = 1;
