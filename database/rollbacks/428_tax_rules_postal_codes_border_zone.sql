-- =============================================================================
-- Rollback 428 — drop postal-code matching from tax_rules
-- =============================================================================
-- Removes the seeded border rules AND the column. After this, every MX client
-- resolves to the org's single default rate again — a border-region subscriber
-- who should be billed 8% goes back to 16%.
--
-- Only the rules this migration seeded are deleted, matched by their exact
-- names. Any rule an operator created themselves is left alone; those simply
-- lose their postal_codes with the column.
--
-- Guarded via INFORMATION_SCHEMA (idempotent — safe to re-run on MySQL 8).
-- =============================================================================

DELETE FROM tax_rules
 WHERE name IN ('IVA Región Fronteriza Norte (8%)', 'IVA Región Fronteriza Sur (8%)');

DROP PROCEDURE IF EXISTS rollback_428_tax_rule_postal_codes;
DELIMITER //
CREATE PROCEDURE rollback_428_tax_rule_postal_codes()
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'tax_rules'
      AND COLUMN_NAME  = 'postal_codes'
  ) THEN
    ALTER TABLE tax_rules DROP COLUMN postal_codes;
  END IF;
END //
DELIMITER ;

CALL rollback_428_tax_rule_postal_codes();
DROP PROCEDURE IF EXISTS rollback_428_tax_rule_postal_codes;
