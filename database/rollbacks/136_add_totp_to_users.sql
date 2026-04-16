-- =============================================================================
-- FireISP 5.0 — Rollback 136: Remove TOTP columns from users
-- =============================================================================
-- Reverses migration 136.  Drops totp_secret, totp_enabled, totp_backup_codes
-- from the users table.
-- WARNING: This destroys all 2FA configuration for every user.
-- =============================================================================

ALTER TABLE users
  DROP COLUMN IF EXISTS totp_backup_codes,
  DROP COLUMN IF EXISTS totp_enabled,
  DROP COLUMN IF EXISTS totp_secret;
