-- Rollback 379: Archived staff accounts are inactive (data backfill)
-- Intentionally a no-op: the backfill normalizes archived users to
-- status='inactive' and the pre-archive status is not recorded anywhere, so
-- it cannot be restored. Leaving archived accounts inactive is safe (and was
-- the intended semantic) even on a rolled-back application version.
SELECT 1;
