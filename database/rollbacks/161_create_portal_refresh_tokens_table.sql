-- =============================================================================
-- FireISP 5.0 — Rollback 161: Drop portal_refresh_tokens table
-- =============================================================================
-- Reverses migration 161.  No other table references portal_refresh_tokens.
-- =============================================================================

DROP TABLE IF EXISTS portal_refresh_tokens;
