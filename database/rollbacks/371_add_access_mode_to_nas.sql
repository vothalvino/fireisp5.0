-- =============================================================================
-- Rollback 371 — Remove access_mode column from nas
-- =============================================================================

ALTER TABLE nas DROP COLUMN IF EXISTS access_mode;
