-- =============================================================================
-- Migration 423 — guarantee at most one ACTIVE default autopay profile
-- =============================================================================
-- completeEnrollment clears other defaults then inserts a new default row, but
-- the clear+insert is not atomic and nothing at the schema level stopped two
-- concurrent setup-session completions (or a webhook fan-out) from leaving two
-- is_default=1 rows. processRecurringCharges charges every is_default=TRUE
-- profile with a distinct idempotency key, so a double default = the card
-- charged twice. This adds a STORED generated column that equals
-- "<client_id>-<gateway_id>" only for ACTIVE default rows (NULL otherwise) and a
-- UNIQUE index on it, so the second default INSERT trips ER_DUP_ENTRY instead.
-- (NULLs repeat freely in a MySQL unique index, so non-default / revoked rows
--  are unconstrained.)
-- =============================================================================

-- Pre-clean any pre-existing duplicate active defaults: keep the newest per
-- (client, gateway), demote the rest — otherwise the UNIQUE index cannot be built.
UPDATE recurring_payment_profiles r
JOIN (
  SELECT client_id, payment_gateway_id, MAX(id) AS keep_id
  FROM recurring_payment_profiles
  WHERE is_default = 1 AND status = 'active'
  GROUP BY client_id, payment_gateway_id
  HAVING COUNT(*) > 1
) dup
  ON dup.client_id = r.client_id
 AND dup.payment_gateway_id = r.payment_gateway_id
SET r.is_default = 0
WHERE r.is_default = 1 AND r.status = 'active' AND r.id <> dup.keep_id;

DROP PROCEDURE IF EXISTS migration_423_recurring_profile_default_guard;
DELIMITER //
CREATE PROCEDURE migration_423_recurring_profile_default_guard()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'recurring_payment_profiles'
      AND COLUMN_NAME  = 'default_guard'
  ) THEN
    ALTER TABLE recurring_payment_profiles
      ADD COLUMN default_guard VARCHAR(64)
        GENERATED ALWAYS AS (
          CASE WHEN is_default = 1 AND status = 'active'
               THEN CONCAT(client_id, '-', payment_gateway_id)
               ELSE NULL END
        ) STORED
        COMMENT 'One active default per (client, gateway): unique key, NULL when not an active default — migration 423';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'recurring_payment_profiles'
      AND INDEX_NAME   = 'uq_recurring_profiles_default_guard'
  ) THEN
    ALTER TABLE recurring_payment_profiles
      ADD UNIQUE KEY uq_recurring_profiles_default_guard (default_guard);
  END IF;
END //
DELIMITER ;
CALL migration_423_recurring_profile_default_guard();
DROP PROCEDURE IF EXISTS migration_423_recurring_profile_default_guard;
