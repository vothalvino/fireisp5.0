-- =============================================================================
-- Rollback 385 — Portal password reset columns on `clients`
-- =============================================================================
-- Drops the lookup index and two columns added by migration 385.
-- INFORMATION_SCHEMA-guarded so a re-run, or a rollback of a partially
-- applied 385, completes instead of aborting on the first already-reverted
-- object.
-- No data restoration is attempted: these columns only ever held an in-flight
-- portal password-reset token (single-use, short-lived) — dropping them is
-- lossless from the product's point of view (any pending reset link simply
-- becomes unredeemable, same as if it had expired).
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_385_add_portal_password_reset_columns;
DELIMITER //
CREATE PROCEDURE rollback_385_add_portal_password_reset_columns()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME    = 'clients'
      AND INDEX_NAME    = 'idx_clients_portal_reset_token_hash'
  ) THEN
    ALTER TABLE clients DROP INDEX idx_clients_portal_reset_token_hash;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_reset_token_expires'
  ) THEN
    ALTER TABLE clients DROP COLUMN portal_reset_token_expires;
  END IF;

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'portal_reset_token_hash'
  ) THEN
    ALTER TABLE clients DROP COLUMN portal_reset_token_hash;
  END IF;
END //
DELIMITER ;
CALL rollback_385_add_portal_password_reset_columns();
DROP PROCEDURE IF EXISTS rollback_385_add_portal_password_reset_columns;
