-- =============================================================================
-- FireISP 5.0 — Rollback 173: Restore clients.client_type to the original
--                             two-value ENUM
-- =============================================================================
-- Reverses migration 173, restoring ENUM('personal','company').
--
-- IRREVERSIBILITY NOTE: rows created with the expanded values are remapped to
-- the nearest legacy value before the column is narrowed, otherwise the ALTER
-- would fail in strict mode:
--   residential -> personal
--   business    -> company
--   government  -> company
--   wholesale   -> company
-- The original expanded value cannot be recovered after this rollback.
--
-- Guarded on the current column type so re-running is a safe no-op.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_173_narrow_client_type;
DELIMITER //
CREATE PROCEDURE rollback_173_narrow_client_type()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'clients'
      AND COLUMN_NAME  = 'client_type'
      AND COLUMN_TYPE LIKE '%residential%'
  ) THEN
    UPDATE clients SET client_type = 'personal' WHERE client_type = 'residential';
    UPDATE clients SET client_type = 'company'  WHERE client_type IN ('business', 'government', 'wholesale');

    ALTER TABLE clients
      MODIFY COLUMN client_type ENUM('personal', 'company') NOT NULL DEFAULT 'personal';
  END IF;
END //
DELIMITER ;
CALL rollback_173_narrow_client_type();
DROP PROCEDURE IF EXISTS rollback_173_narrow_client_type;
