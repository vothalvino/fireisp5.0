-- =============================================================================
-- Migration 359 — Fix billing-number UNIQUE keys to be org-scoped
-- =============================================================================
-- The single-column UNIQUE keys on invoice_number, quote_number, and
-- credit_note_number prevent concurrent number generation across organisations
-- from reusing the same number string (e.g. "INV-0001" is valid in every org,
-- but the global constraint makes the second INSERT fail with a duplicate-key
-- error).  The correct pattern, already used by service_orders, scopes each
-- constraint to (organization_id, <number_column>).
--
-- Migration 186 added organization_id to invoices, quotes, and credit_notes but
-- did not update these constraints.  This migration finishes that work.
--
-- Each step is guarded on INFORMATION_SCHEMA so the migration is idempotent.
-- =============================================================================

DROP PROCEDURE IF EXISTS migration_359_fix_billing_number_unique_constraints;
DELIMITER //
CREATE PROCEDURE migration_359_fix_billing_number_unique_constraints()
BEGIN

  -- -------------------------------------------------------------------------
  -- invoices: uq_invoices_number  →  uq_invoices_org_number
  -- -------------------------------------------------------------------------

  -- Drop the old single-column key (only if it still exists).
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND INDEX_NAME   = 'uq_invoices_number'
  ) THEN
    ALTER TABLE invoices DROP INDEX uq_invoices_number;
  END IF;

  -- Add the org-scoped composite key (only if not already present).
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'invoices'
      AND INDEX_NAME   = 'uq_invoices_org_number'
  ) THEN
    ALTER TABLE invoices
      ADD UNIQUE KEY uq_invoices_org_number (organization_id, invoice_number);
  END IF;

  -- -------------------------------------------------------------------------
  -- quotes: uq_quotes_number  →  uq_quotes_org_number
  -- -------------------------------------------------------------------------

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND INDEX_NAME   = 'uq_quotes_number'
  ) THEN
    ALTER TABLE quotes DROP INDEX uq_quotes_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'quotes'
      AND INDEX_NAME   = 'uq_quotes_org_number'
  ) THEN
    ALTER TABLE quotes
      ADD UNIQUE KEY uq_quotes_org_number (organization_id, quote_number);
  END IF;

  -- -------------------------------------------------------------------------
  -- credit_notes: uq_credit_notes_number  →  uq_credit_notes_org_number
  -- -------------------------------------------------------------------------

  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_notes'
      AND INDEX_NAME   = 'uq_credit_notes_number'
  ) THEN
    ALTER TABLE credit_notes DROP INDEX uq_credit_notes_number;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'credit_notes'
      AND INDEX_NAME   = 'uq_credit_notes_org_number'
  ) THEN
    ALTER TABLE credit_notes
      ADD UNIQUE KEY uq_credit_notes_org_number (organization_id, credit_note_number);
  END IF;

END //
DELIMITER ;
CALL migration_359_fix_billing_number_unique_constraints();
DROP PROCEDURE IF EXISTS migration_359_fix_billing_number_unique_constraints;
