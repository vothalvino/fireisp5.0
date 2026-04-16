-- =============================================================================
-- FireISP 5.0 — Rollback 140: Remove brute-force lockout columns from users
-- =============================================================================
-- Reverses migration 140.
-- =============================================================================

ALTER TABLE users
  DROP COLUMN IF EXISTS locked_until,
  DROP COLUMN IF EXISTS failed_login_attempts;
