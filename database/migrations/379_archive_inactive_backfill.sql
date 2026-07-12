-- =============================================================================
-- Migration 379 — Archived staff accounts are inactive (data backfill)
-- =============================================================================
-- "Deleting" a staff user is now ARCHIVING: User.delete soft-deletes AND
-- forces status='inactive' in one statement, so restoring an archived account
-- never revives a login-able user. Accounts archived BEFORE that change kept
-- whatever status they had — usually 'active' — which meant:
--   * restoring them produced an immediately login-able account, and
--   * their API tokens still authenticated (the X-API-Key path gated only on
--     status; it now also requires u.deleted_at IS NULL — belt and braces).
-- Normalize the existing rows. Data-only, idempotent; no DDL, so no
-- schema.sql change. Irreversible by design (the pre-archive status is not
-- recorded anywhere) — restored accounts are meant to come back inactive.
-- =============================================================================

UPDATE users
SET status = 'inactive'
WHERE deleted_at IS NOT NULL
  AND status != 'inactive';
