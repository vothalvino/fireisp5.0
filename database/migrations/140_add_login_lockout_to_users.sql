-- =============================================================================
-- Migration 140: Add brute-force lockout columns to users table
-- =============================================================================
-- Adds failed_login_attempts and locked_until columns to support account
-- lockout after repeated failed login attempts.
-- =============================================================================

ALTER TABLE users
  ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0
    COMMENT 'Consecutive failed login attempts since last successful login',
  ADD COLUMN locked_until TIMESTAMP NULL DEFAULT NULL
    COMMENT 'Account locked until this timestamp; NULL = not locked';
