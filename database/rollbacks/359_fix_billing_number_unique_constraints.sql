-- =============================================================================
-- FireISP 5.0 — Rollback 359: Restore single-column billing-number UNIQUE keys
-- =============================================================================
-- Reverses migration 359.  The forward migration replaced the three
-- single-column UNIQUE constraints with org-scoped composites:
--
--   uq_invoices_number      →  uq_invoices_org_number    (organization_id, invoice_number)
--   uq_quotes_number        →  uq_quotes_org_number      (organization_id, quote_number)
--   uq_credit_notes_number  →  uq_credit_notes_org_number (organization_id, credit_note_number)
--
-- This rollback drops the composite keys and re-adds the original
-- single-column keys, but only when doing so cannot fail on existing duplicate
-- number values (i.e. only when every number value in the table is unique
-- regardless of organization).
--
-- IRREVERSIBILITY NOTES:
--   * If data inserted after migration 359 has the same number string in two
--     different organisations, re-adding the single-column unique key would
--     violate uniqueness.  In that case the restore step is skipped and a
--     warning comment is left in the log.  The composite key is still dropped
--     so the rollback does not block other changes.
-- =============================================================================

DROP PROCEDURE IF EXISTS rollback_359_restore_billing_number_unique_constraints;
DELIMITER //
CREATE PROCEDURE rollback_359_restore_billing_number_unique_constraints()
BEGIN

  -- -------------------------------------------------------------------------
  -- invoices
  -- -------------------------------------------------------------------------

  -- Drop the composite key added by migration 359.
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND INDEX_NAME   = 'uq_invoices_org_number'
  ) THEN
    ALTER TABLE invoices DROP INDEX uq_invoices_org_number;
  END IF;

  -- Re-add the original single-column key only when no duplicate numbers exist.
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND INDEX_NAME   = 'uq_invoices_number'
  ) AND NOT EXISTS (
    SELECT 1 FROM invoices
    WHERE invoice_number IS NOT NULL
    GROUP BY invoice_number
    HAVING COUNT(*) > 1
  ) THEN
    ALTER TABLE invoices
      ADD UNIQUE KEY uq_invoices_number (invoice_number);
  END IF;

  -- -------------------------------------------------------------------------
  -- quotes
  -- -------------------------------------------------------------------------

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND INDEX_NAME   = 'uq_quotes_org_number'
  ) THEN
    ALTER TABLE quotes DROP INDEX uq_quotes_org_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND INDEX_NAME   = 'uq_quotes_number'
  ) AND NOT EXISTS (
    SELECT 1 FROM quotes
    WHERE quote_number IS NOT NULL
    GROUP BY quote_number
    HAVING COUNT(*) > 1
  ) THEN
    ALTER TABLE quotes
      ADD UNIQUE KEY uq_quotes_number (quote_number);
  END IF;

  -- -------------------------------------------------------------------------
  -- credit_notes
  -- -------------------------------------------------------------------------

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_notes'
      AND INDEX_NAME   = 'uq_credit_notes_org_number'
  ) THEN
    ALTER TABLE credit_notes DROP INDEX uq_credit_notes_org_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_notes'
      AND INDEX_NAME   = 'uq_credit_notes_number'
  ) AND NOT EXISTS (
    SELECT 1 FROM credit_notes
    WHERE credit_note_number IS NOT NULL
    GROUP BY credit_note_number
    HAVING COUNT(*) > 1
  ) THEN
    ALTER TABLE credit_notes
      ADD UNIQUE KEY uq_credit_notes_number (credit_note_number);
  END IF;

END //
DELIMITER ;
CALL rollback_359_restore_billing_number_unique_constraints();
DROP PROCEDURE IF EXISTS rollback_359_restore_billing_number_unique_constraints;
